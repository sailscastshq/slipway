const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { randomInt, createHash } = require('node:crypto')

// A disposable process contract. No app, customer data, database or job runs.
module.exports = async function commandFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'helm-command-test-'))
  const appId = String(randomInt(100000000, 999999999))
  const deploymentId = '1'
  const environment = {
    ...process.env,
    SLIPWAY_APP_ID: appId,
    SLIPWAY_DEPLOYMENT_ID: deploymentId,
    HELM_COMMAND_FIXTURE: 'deployed-fixture-value'
  }
  delete environment.SLIPWAY_HELM_EXECUTION_ID
  await fs.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ dependencies: { sails: '*' } })
  )
  await fs.writeFile(path.join(root, 'app.js'), 'setInterval(() => {}, 1000)')
  const app = spawn(process.execPath, ['app.js'], {
    cwd: root,
    env: environment,
    stdio: 'ignore'
  })
  await new Promise((resolve, reject) => {
    app.once('spawn', resolve)
    app.once('error', reject)
  })
  const stat = await fs.readFile(`/proc/${app.pid}/stat`, 'utf8')
  const startTicks = stat
    .slice(stat.lastIndexOf(')') + 1)
    .trim()
    .split(/\s+/)[19]
  const executable = await fs.readlink(`/proc/${app.pid}/exe`)
  const contractDir = '/tmp/slipway-helm-runtimes'
  await fs.mkdir(contractDir, { recursive: true })
  const contractPath = path.join(
    contractDir,
    `${appId}-${deploymentId}-${app.pid}.json`
  )
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify(
        Object.keys(environment)
          .sort()
          .map((key) => [key, environment[key]])
      )
    )
    .digest('hex')
  const contract = {
    version: 1,
    appId,
    deploymentId,
    pid: app.pid,
    startTicks,
    executable,
    appPath: root,
    environmentSource: 'process-start',
    environmentFingerprint: fingerprint,
    datastoreFingerprint: '0'.repeat(64),
    argvStartIndex: 1
  }
  await fs.writeFile(contractPath, JSON.stringify(contract), { mode: 0o600 })
  return {
    root,
    app,
    contract,
    contractPath,
    expectedRuntime: { appId, deploymentId, required: true },
    async close() {
      if (app.exitCode === null && app.signalCode === null) {
        const closed = new Promise((resolve) => app.once('close', resolve))
        app.kill('SIGKILL')
        await closed
      }
      await fs.rm(contractPath, { force: true })
      await fs.rm(root, { force: true, recursive: true })
    }
  }
}
