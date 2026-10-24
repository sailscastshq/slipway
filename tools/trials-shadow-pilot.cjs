#!/usr/bin/env node
// Local, trusted-source proof only. Not a registered runner or production CI service.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')
const { performance } = require('node:perf_hooks')
const hash = (value) =>
  'sha256:' + crypto.createHash('sha256').update(value).digest('hex')
const MAX_LOG_BYTES = 10 * 1024 * 1024
let child,
  container,
  output,
  report,
  deadline,
  logBytes = 0,
  stopReason

function save() {
  if (!report || !output) return
  fs.writeFileSync(
    path.join(output, 'report.json.next'),
    JSON.stringify(report, null, 2) + '\n',
    { mode: 0o600 }
  )
  fs.renameSync(
    path.join(output, 'report.json.next'),
    path.join(output, 'report.json')
  )
}
function command(
  binary,
  args,
  { input, log, timeout = 30000, captureLimit = 1024 * 1024 } = {}
) {
  return new Promise((resolve, reject) => {
    if (stopReason) return reject(new Error(stopReason))
    const proc = spawn(binary, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    child = proc
    const chunks = []
    let captured = 0,
      failure
    const remaining = deadline ? deadline - Date.now() : timeout
    const timer = setTimeout(() => {
      stopReason = 'timed-out'
      failure = new Error('Command deadline exceeded.')
      proc.kill('SIGTERM')
    }, Math.max(1, Math.min(timeout, remaining)))
    const stream = log
      ? fs.createWriteStream(path.join(output, log), { mode: 0o600 })
      : null
    function consume(data) {
      logBytes += data.length
      if (logBytes > MAX_LOG_BYTES) {
        failure = new Error('Run output limit exceeded.')
        proc.kill('SIGTERM')
        return
      }
      if (stream) stream.write(data)
      if (captured + data.length <= captureLimit) {
        chunks.push(data)
        captured += data.length
      }
    }
    proc.stdin.on('error', () => {})
    proc.stdout.on('data', consume)
    proc.stderr.on('data', consume)
    proc.on('error', (error) => {
      failure = error
    })
    proc.on('close', (code) => {
      clearTimeout(timer)
      stream?.end()
      if (child === proc) child = null
      if (failure) reject(failure)
      else resolve({ code, text: Buffer.concat(chunks).toString('utf8') })
    })
    if (input) {
      input.on('error', () => proc.stdin.destroy())
      input.pipe(proc.stdin)
    } else proc.stdin.end()
  })
}
async function checked(binary, args, options) {
  const result = await command(binary, args, options)
  if (result.code !== 0)
    throw new Error(
      `${binary} failed during preparation (exit ${result.code}); inspect the local evidence.`
    )
  return options?.raw ? result.text : result.text.trim()
}
async function stats() {
  try {
    const text = await checked('docker', [
      'exec',
      container,
      'node',
      '-e',
      `const f=require('fs');const r=p=>{try{return f.readFileSync(p,'utf8')}catch{return null}};console.log(JSON.stringify({cpu:r('/sys/fs/cgroup/cpu.stat'),memoryPeak:r('/sys/fs/cgroup/memory.peak')}))`
    ])
    const data = JSON.parse(text)
    return {
      cpuSeconds:
        Number(data.cpu?.match(/^usage_usec (\d+)/m)?.[1]) / 1e6 || null,
      peakMemoryBytes:
        data.memoryPeak && Number.isFinite(Number(data.memoryPeak))
          ? Number(data.memoryPeak)
          : null
    }
  } catch {
    return { cpuSeconds: null, peakMemoryBytes: null }
  }
}
async function main() {
  const flags = {}
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i],
      value = process.argv[i + 1]
    if (
      ![
        '--repo',
        '--commit',
        '--image',
        '--approve',
        '--approve-install',
        '--out',
        '--retry-of'
      ].includes(key) ||
      !value ||
      Object.hasOwn(flags, key)
    )
      throw new Error(
        'Expected --repo PATH --commit FULL_SHA --image node@sha256:DIGEST --approve test,build --approve-install yes --out NEW_DIR'
      )
    flags[key] = value
  }
  if (
    !/^[a-f0-9]{40}$/.test(flags['--commit'] || '') ||
    !/^node@sha256:[a-f0-9]{64}$/.test(flags['--image'] || '') ||
    flags['--approve-install'] !== 'yes'
  )
    throw new Error(
      'Review the exact commit, immutable runtime and install scripts before this local proof.'
    )
  const approved = (flags['--approve'] || '').split(',')
  if (
    !approved.length ||
    approved.some((name) => !['test', 'build', 'lint'].includes(name)) ||
    new Set(approved).size !== approved.length
  )
    throw new Error(
      'Only reviewed test, build and optional lint scripts are supported in this prototype.'
    )
  if (flags['--retry-of'] && !/^[a-f0-9-]{36}$/.test(flags['--retry-of']))
    throw new Error('A retry must reference the original run UUID.')
  const repo = fs.realpathSync(flags['--repo'])
  const sha = flags['--commit']
  const source = async (file) =>
    checked('git', ['-C', repo, 'show', `${sha}:${file}`], {
      captureLimit: 32 * 1024 * 1024,
      raw: true
    })
  const manifestText = await source('package.json')
  const lockText = await source('package-lock.json')
  const manifest = JSON.parse(manifestText),
    lock = JSON.parse(lockText)
  if (
    manifest.version !== lock.version ||
    manifest.version !== lock.packages?.['']?.version
  )
    throw new Error('Package and lockfile versions disagree.')
  for (const name of approved)
    if (typeof manifest.scripts?.[name] !== 'string')
      throw new Error(`Approved script ${name} is missing.`)
  const files = await checked('git', [
    '-C',
    repo,
    'ls-tree',
    '-r',
    '--name-only',
    sha
  ])
  if (
    files
      .split('\n')
      .some(
        (file) =>
          /(^|\/)(\.env(?:\.[^/]+)?|\.tmp|node_modules|db)(\/|$)|\.(?:sqlite|db|db-wal|db-shm)$/.test(
            file
          ) && !/\.env\.(?:example|sample)$/.test(file)
      )
  )
    throw new Error(
      'Tracked runtime or environment files need review before entering a CI workspace.'
    )
  const endpoint = JSON.parse(
    await checked('docker', [
      'context',
      'inspect',
      '--format',
      '{{json .Endpoints.docker.Host}}'
    ])
  )
  const docker = JSON.parse(
    await checked('docker', ['info', '--format', '{{json .}}'])
  )
  if (
    !endpoint.startsWith('unix://') ||
    !String(docker.OperatingSystem).includes('Docker Desktop') ||
    (process.env.DOCKER_HOST && !process.env.DOCKER_HOST.startsWith('unix://'))
  )
    throw new Error(
      'This local prototype accepts only Docker Desktop through a local Unix socket. It cannot register or use production runners.'
    )
  if (docker.MemTotal < 5 * 1024 ** 3)
    throw new Error(
      'The local proof needs at least 5 GiB available in its Docker VM.'
    )
  output = path.resolve(flags['--out'])
  if (fs.existsSync(output))
    throw new Error(
      'Choose a new evidence directory; existing runs are immutable.'
    )
  fs.mkdirSync(output, { recursive: true, mode: 0o700 })
  const image = JSON.parse(
    await checked('docker', [
      'image',
      'inspect',
      flags['--image'],
      '--format',
      '{{json .}}'
    ])
  )
  if (image.Os !== 'linux')
    throw new Error('The reviewed runtime must be Linux.')
  const id = crypto.randomUUID()
  container = `slipway-trials-local-${id}`
  const started = performance.now()
  deadline = Date.now() + 600000
  const configuration = {
    scripts: approved.map((name) => ({ name, script: manifest.scripts[name] })),
    install: ['npm', 'ci'],
    runtime: flags['--image'],
    testProfile: 'sailsconf-sqlite-no-egress-v2',
    filesystem: {
      root: 'read-only',
      workspace: 'tmpfs-exec',
      temporary: 'tmpfs-noexec'
    },
    networkPolicy: 'install-egress-then-none',
    user: '1000:1000',
    cpus: 2,
    memoryBytes: 4 * 1024 ** 3,
    workspaceBytes: 1536 * 1024 ** 2,
    timeoutSeconds: 600
  }
  report = {
    prototype: true,
    scope: 'source-checks-only',
    deployable: false,
    deploymentGate:
      'No application image was built or verified; production deployment remains blocked.',
    id,
    retryOf: flags['--retry-of'] || null,
    state: 'preparing',
    sourceRevision: sha,
    metadataDigestEncoding: 'raw UTF-8 Git blob',
    manifestDigest: hash(manifestText),
    lockDigest: hash(lockText),
    configRevision: hash(JSON.stringify(configuration)),
    configuration,
    runtime: {
      image: flags['--image'],
      imageId: image.Id,
      architecture: image.Architecture,
      unpackedImageBytes: image.Size
    },
    startedAt: new Date().toISOString(),
    cache: 'cold, disposable package cache',
    steps: [],
    cleanup: { state: 'pending' }
  }
  save()
  try {
    await checked('docker', [
      'run',
      '-d',
      '--name',
      container,
      '--label',
      `slipway.trials.local=${id}`,
      '--cpus',
      '2',
      '--memory',
      '4g',
      '--memory-swap',
      '4g',
      '--pids-limit',
      '256',
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--user',
      '1000:1000',
      '--init',
      '--workdir',
      '/workspace',
      '--tmpfs',
      '/workspace:rw,exec,nosuid,nodev,size=1536m,uid=1000,gid=1000',
      '--tmpfs',
      '/tmp:rw,nosuid,nodev,size=256m,uid=1000,gid=1000',
      '--env',
      'NODE_ENV=test',
      '--env',
      'CI=true',
      '--env',
      'HOME=/tmp/home',
      '--env',
      'npm_config_cache=/tmp/npm-cache',
      '--env',
      'npm_config_update_notifier=false',
      '--env',
      'DATABASE_PATH=.tmp/db/test.sqlite',
      flags['--image'],
      'node',
      '-e',
      'setInterval(()=>{},1000)'
    ])
    const archive = spawn('git', ['-C', repo, 'archive', '--format=tar', sha], {
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let archiveError
    archive.on('error', (error) => {
      archiveError = error
    })
    const archiveDone = new Promise((resolve) => archive.on('close', resolve))
    await checked(
      'docker',
      ['exec', '-i', container, 'tar', '-xf', '-', '-C', '/workspace'],
      { input: archive.stdout, timeout: 120000 }
    )
    if ((await archiveDone) !== 0 || archiveError)
      throw new Error('Exact-commit source export failed.')
    report.runtime.node = await checked('docker', [
      'exec',
      container,
      'node',
      '--version'
    ])
    report.runtime.npm = await checked('docker', [
      'exec',
      container,
      'npm',
      '--version'
    ])
    const nodeVersion = /^v(\d+)\.(\d+)\./.exec(report.runtime.node)
    if (
      !nodeVersion ||
      Number(nodeVersion[1]) !== 22 ||
      Number(nodeVersion[2]) < 12
    )
      throw new Error(
        'The reviewed SailsConf pilot profile requires Node 22.12 or newer on the 22.x line.'
      )
    report.state = 'running'
    save()
    const commands = [
      ['install', ['ci']],
      ...approved.map((name) => [name, ['run', name]])
    ]
    for (const [name, args] of commands) {
      const stepStarted = performance.now()
      const step = { name, required: true, state: 'running' }
      report.steps.push(step)
      save()
      const result = await command(
        'docker',
        ['exec', container, 'npm', ...args],
        { log: `${name}.log`, timeout: 600000, captureLimit: 0 }
      )
      step.durationSeconds =
        Math.round((performance.now() - stepStarted) / 10) / 100
      step.exitCode = result.code
      step.state = result.code === 0 ? 'passed' : 'failed'
      step.resources = await stats()
      save()
      if (result.code !== 0) {
        const error = new Error(
          `${name} failed (exit ${result.code}); local log retained.`
        )
        error.failureClass =
          result.code === 125
            ? 'runner-unavailable'
            : name === 'install'
            ? 'setup-failed'
            : 'code-failed'
        throw error
      }
      if (name === 'install') {
        await checked('docker', ['network', 'disconnect', 'bridge', container])
        const networks = JSON.parse(
          await checked('docker', [
            'inspect',
            container,
            '--format',
            '{{json .NetworkSettings.Networks}}'
          ])
        )
        if (Object.keys(networks).length)
          throw new Error('Checks must run without external network access.')
        report.checkNetwork = 'disconnected'
        save()
      }
    }
    report.state = 'passed'
  } catch (error) {
    report.state = stopReason || 'failed'
    report.failureClass =
      error.failureClass ||
      (stopReason === 'timed-out'
        ? 'timed-out'
        : stopReason === 'cancelled'
        ? 'cancelled'
        : 'runner-or-setup-failed')
    report.reason = error.message
    const active = report.steps.find((step) => step.state === 'running')
    if (active) active.state = report.state
    process.exitCode = 1
  } finally {
    const reason = stopReason
    stopReason = null
    deadline = null
    report.logBytes = logBytes
    logBytes = 0
    report.resources = await stats()
    const cleanup = await command('docker', ['rm', '-f', container], {
      timeout: 30000
    }).catch(() => ({ code: 1 }))
    report.cleanup = {
      state: cleanup.code === 0 ? 'completed' : 'failed',
      container
    }
    if (cleanup.code !== 0) {
      report.state = 'failed'
      report.reason = 'Cleanup needs operator inspection.'
      process.exitCode = 1
    }
    stopReason = reason
    report.durationSeconds =
      Math.round((performance.now() - started) / 10) / 100
    report.finishedAt = new Date().toISOString()
    save()
    process.stdout.write(
      JSON.stringify({
        report: path.join(output, 'report.json'),
        state: report.state,
        deployable: false,
        durationSeconds: report.durationSeconds,
        cleanup: report.cleanup.state
      }) + '\n'
    )
  }
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    stopReason = 'cancelled'
    child?.kill('SIGTERM')
  })
main().catch((error) => {
  process.stderr.write(error.message + '\n')
  process.exitCode = 1
})
