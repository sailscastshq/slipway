import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { api } from './api.js'
import {
  getCredentials,
  getProjectConfig,
  getConfigDirectory
} from './config.js'
import { credentialStore } from './credential-store.js'
import contract from './ci-contract.cjs'
const here = path.dirname(fileURLToPath(import.meta.url))
export function ciTarget(options = {}) {
  const project = options.project || getProjectConfig()?.project
  const env = options.env || 'production',
    app = options.app
  if (
    ![project, env, app].every(
      (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(value)
    )
  )
    throw new Error('Choose an explicit --project, --env and --app for CI.')
  return {
    project,
    env,
    app,
    key: `${project}/${env}/${app}`,
    base: `/projects/${project}/environments/${env}/apps/${app}/ci`
  }
}
function context(options) {
  const target = ciTarget(options),
    credentials = getCredentials()
  if (!credentials.server || !credentials.token)
    throw new Error('Run slipway login before using trusted local CI.')
  const identity = crypto
    .createHash('sha256')
    .update(credentials.server + '\n' + target.key)
    .digest('hex')
    .slice(0, 24)
  const directory = path.join(getConfigDirectory(), 'ci', identity)
  return { target, directory, store: credentialStore(directory) }
}
function approval(options, target) {
  if (options['approve-target'] !== target.key)
    throw new Error(
      `Review the target and pass --approve-target ${target.key}.`
    )
}
export async function setup(options) {
  const { target } = context(options)
  approval(options, target)
  if (!options['approve-policy'])
    throw new Error(
      'Review install lifecycle scripts, lint/test/build, platform and local-device trust; then pass --approve-policy.'
    )
  const { policy } = await api.post(
    target.base + '/policy',
    {
      commit: options.commit,
      branch: options.branch || 'main',
      image: options.image,
      platform: options.platform,
      enabled: !options.disable,
      approvePolicy: true,
      policyRevision: options['policy-revision']
    },
    { timeoutMs: 60000 }
  )
  console.log(JSON.stringify({ target: target.key, policy }, null, 2))
}
export async function register(options) {
  const { target, store } = context(options)
  approval(options, target)
  if (!options['trust-device'])
    throw new Error(
      'Only register a device you trust to report checks honestly. Pass --trust-device after review.'
    )
  const { policy } = await api.get(target.base + '/policy')
  if (!policy?.enabled)
    throw new Error('Save and enable a reviewed CI policy first.')
  let saved = store.read()
  if (!saved.privateKey) {
    const pair = crypto.generateKeyPairSync('ed25519')
    saved = {
      privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' })
    }
    store.write(saved)
  }
  const publicKey = crypto
    .createPublicKey(saved.privateKey)
    .export({ type: 'spki', format: 'pem' })
  const result = await api.post(target.base + '/approve-runner', {
    name: options.name || os.hostname(),
    publicKey,
    policyRevision: policy.revision,
    trustDevice: true
  })
  store.write({
    ...saved,
    runnerId: result.runner.runnerId,
    policy,
    target: target.key
  })
  console.log(
    JSON.stringify(
      {
        target: target.key,
        runner: result.runner,
        privateKeyStoredOutsideProject: true
      },
      null,
      2
    )
  )
}
export async function submit(options) {
  const { target, store } = context(options),
    saved = store.read()
  if (!saved.privateKey || !saved.runnerId)
    throw new Error('Register this device with slipway ci:register first.')
  if (!options.report || fs.statSync(options.report).size > 65536)
    throw new Error('Provide the bounded local report using --report PATH.')
  const report = JSON.parse(fs.readFileSync(options.report, 'utf8'))
  const { challenge } = await api.post(
    target.base + '/challenge',
    { runnerId: saved.runnerId, commit: report.sourceRevision },
    { timeoutMs: 60000 }
  )
  const signature = crypto
    .sign(
      null,
      Buffer.from(contract.canonical(contract.statement(challenge, report))),
      saved.privateKey
    )
    .toString('base64url')
  const result = await api.post(target.base + '/receipt', {
    runnerId: saved.runnerId,
    runId: challenge.runId,
    report,
    signature
  })
  console.log(JSON.stringify({ ...result, deploymentApproval: false }, null, 2))
  if (result.run.state !== 'passed') process.exitCode = 1
  return result
}
export async function run(options) {
  const { target, directory } = context(options)
  const { policy } = await api.get(target.base + '/policy')
  if (!policy?.enabled)
    throw new Error('An enabled reviewed CI policy is required.')
  const repo = fs.realpathSync(options.repo || process.cwd())
  const commit =
    options.commit ||
    execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], {
      encoding: 'utf8'
    }).trim()
  if (!/^[a-f0-9]{40}$/.test(commit))
    throw new Error('An exact commit is required.')
  const manifest = JSON.parse(
    execFileSync('git', ['-C', repo, 'show', `${commit}:package.json`], {
      encoding: 'utf8',
      maxBuffer: 262144
    })
  )
  const execution = contract.configuration(
    manifest,
    policy.configuration.execution.runtime,
    policy.configuration.execution.platform
  )
  if (contract.digest(execution) !== policy.configuration.configRevision)
    throw new Error(
      'The local scripts or executor changed. Review a new policy before running.'
    )
  const output = path.resolve(
    options.out || path.join(directory, 'runs', crypto.randomUUID())
  )
  console.log(
    `Slipway CI: ${target.key} · ${commit.slice(0, 12)} · ${execution.platform}`
  )
  console.log(
    'Checks cover the committed source; uncommitted changes are excluded.'
  )
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        path.join(here, 'ci-executor.cjs'),
        '--repo',
        repo,
        '--commit',
        commit,
        '--image',
        execution.runtime,
        '--platform',
        execution.platform,
        '--approve',
        'lint,test,build',
        '--approve-install',
        'yes',
        '--out',
        output
      ],
      { stdio: 'inherit' }
    )
    child.on('error', reject)
    child.on('exit', (code) => resolve(code ?? 1))
  })
  const reportPath = path.join(output, 'report.json')
  console.log(`Local report: ${reportPath}`)
  if (!options.local && fs.existsSync(reportPath)) {
    try {
      await submit({ ...options, report: reportPath })
    } catch (error) {
      console.error(
        `Local evidence retained. Push this exact commit to the reviewed branch, then use ci:submit --report PATH. ${error.message}`
      )
      process.exitCode = 1
      return
    }
  }
  if (exitCode) process.exitCode = exitCode
}
export async function status(options) {
  const { target } = context(options)
  console.log(JSON.stringify(await api.get(target.base + '/runs'), null, 2))
}
export async function revoke(options) {
  const { target } = context(options)
  approval(options, target)
  if (!options.runner) throw new Error('Provide --runner UUID to revoke.')
  console.log(
    JSON.stringify(
      await api.post(target.base + '/revoke-runner', {
        runnerId: options.runner
      })
    )
  )
}
