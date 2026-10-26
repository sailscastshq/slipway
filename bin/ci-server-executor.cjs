#!/usr/bin/env node
// Bounded server source checks. Device signing and server admission stay outside this process.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')
const tar = require('tar-stream')
const { finished } = require('node:stream/promises')
const { performance } = require('node:perf_hooks')
const hash = (value) =>
  'sha256:' + crypto.createHash('sha256').update(value).digest('hex')
const contract = require('../api/lib/contracts/ci-contract')
const CACHE_BYTES = 64 * 1024 * 1024
const CACHE_TTL = 7 * 24 * 3600000
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
  { input, log, binaryFile, timeout = 30000, captureLimit = 1024 * 1024 } = {}
) {
  return new Promise((resolve, reject) => {
    if (stopReason) return reject(new Error(stopReason))
    const proc = spawn(binary, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    child = proc
    const chunks = []
    let captured = 0,
      binaryBytes = 0,
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
    const cacheStream = binaryFile
      ? fs.createWriteStream(binaryFile, { flags: 'wx', mode: 0o600 })
      : null
    const cacheDone = cacheStream
      ? finished(cacheStream).catch((error) => {
          failure = error
        })
      : null
    cacheStream?.on('error', (error) => {
      failure = error
      proc.kill('SIGTERM')
    })
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
    proc.stdout.on('data', (data) => {
      if (!cacheStream) return consume(data)
      binaryBytes += data.length
      if (binaryBytes > CACHE_BYTES) {
        failure = new Error('Package cache exceeds its archive budget.')
        proc.kill('SIGTERM')
      } else if (!cacheStream.write(data)) {
        proc.stdout.pause()
        cacheStream.once('drain', () => proc.stdout.resume())
      }
    })
    proc.stderr.on('data', consume)
    proc.on('error', (error) => {
      failure = error
    })
    proc.on('close', async (code) => {
      clearTimeout(timer)
      stream?.end()
      if (cacheStream) {
        cacheStream.end()
        await cacheDone
      }
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
      `const f=require('fs');const r=p=>{try{return f.readFileSync(p,'utf8')}catch{return null}};const mounts={};for(const p of ['/workspace','/tmp']){try{const s=f.statfsSync(p);mounts[p]={totalBytes:s.blocks*s.bsize,availableBytes:s.bavail*s.bsize,totalInodes:s.files,availableInodes:s.ffree}}catch{mounts[p]=null}};console.log(JSON.stringify({cpu:r('/sys/fs/cgroup/cpu.stat'),memoryPeak:r('/sys/fs/cgroup/memory.peak'),mounts}))`
    ])
    const data = JSON.parse(text)
    return {
      mounts: data.mounts,
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
async function validateCacheArchive(file) {
  const extract = tar.extract()
  let entries = 0
  extract.on('entry', (header, stream, next) => {
    if (
      ++entries > 10000 ||
      header.name.length > 512 ||
      !/^_cacache\/(content-v2|index-v5)(\/[A-Za-z0-9_-]+)*\/?$/.test(
        header.name
      ) ||
      !['file', 'directory'].includes(header.type) ||
      !Number.isSafeInteger(header.size) ||
      header.size < 0 ||
      header.size > CACHE_BYTES
    ) {
      stream.resume()
      extract.destroy(
        new Error('Package cache contains an unsafe archive entry.')
      )
      return
    }
    stream.on('end', next)
    stream.resume()
  })
  const input = fs.createReadStream(file)
  input.on('error', (error) => extract.destroy(error))
  try {
    input.pipe(extract)
    await finished(extract)
  } finally {
    input.destroy()
  }
}
async function packageCache(flags, lock) {
  const directory = flags['--cache-dir']
  const scope = flags['--cache-scope']
  const cache = { state: 'disabled', maxArchiveBytes: CACHE_BYTES }
  report.cache = cache
  if (!directory) return {}
  if (!/^[a-f0-9]{64}$/.test(scope || ''))
    throw new Error('A server-owned cache scope is required.')
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const stat = fs.lstatSync(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o077)
    throw new Error('Package cache requires a private server-owned directory.')
  // One global slot: at most one 64 MiB archive plus one bounded replacement.
  // Never extract repository-controlled archive entries on the management host.
  const key = crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        scope,
        lock: report.lockDigest,
        runtime: report.runtime,
        configuration: report.configRevision
      })
    )
    .digest('hex')
  const file = path.join(directory, key + '.tar')
  for (const name of fs.readdirSync(directory)) {
    if (!/^[a-f0-9]{64}\.tar(?:\.next)?$/.test(name)) continue
    const candidate = path.join(directory, name),
      info = fs.lstatSync(candidate)
    if (
      name !== key + '.tar' ||
      Date.now() - info.mtimeMs > CACHE_TTL ||
      !info.isFile() ||
      info.size > CACHE_BYTES
    )
      fs.unlinkSync(candidate)
  }
  // Git/file/link dependencies do not always have lockfile integrity. Keep them cold.
  const packages = Object.entries(lock.packages || {}).filter(([name]) => name)
  if (
    !lock.packages ||
    packages.some(
      ([, item]) =>
        !item.resolved?.startsWith('https://') ||
        !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(item.integrity || '')
    )
  ) {
    cache.state = 'ineligible-lockfile'
    return {}
  }
  cache.state = 'miss'
  await checked('docker', [
    'exec',
    container,
    'rm',
    '-rf',
    '/workspace/.npm-cache'
  ])
  await checked('docker', [
    'exec',
    container,
    'mkdir',
    '-p',
    '/workspace/.npm-cache'
  ])
  let fd
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
    const info = fs.fstatSync(fd)
    if (!info.isFile() || info.size > CACHE_BYTES)
      throw new Error('Invalid cache archive.')
    await validateCacheArchive(file)
    await checked(
      'docker',
      [
        'exec',
        '-i',
        container,
        'tar',
        '--no-same-owner',
        '--no-same-permissions',
        '-xf',
        '-',
        '-C',
        '/workspace/.npm-cache'
      ],
      { input: fs.createReadStream(file, { fd, autoClose: false }) }
    )
    cache.state = 'hit'
    cache.restoredBytes = info.size
  } catch (error) {
    if (error.code !== 'ENOENT') {
      cache.state = 'invalid-archive'
      await checked('docker', [
        'exec',
        container,
        'rm',
        '-rf',
        '/workspace/.npm-cache'
      ])
    }
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
  return {
    async publish() {
      if (cache.state === 'hit') {
        cache.publish = 'unchanged'
        return
      }
      const next = file + '.next'
      try {
        await checked(
          'docker',
          [
            'exec',
            container,
            'tar',
            '-cf',
            '-',
            '-C',
            '/workspace/.npm-cache',
            '_cacache/content-v2',
            '_cacache/index-v5'
          ],
          { binaryFile: next, captureLimit: 0 }
        )
        const info = fs.lstatSync(next)
        if (info.size > CACHE_BYTES) throw new Error('Cache archive too large.')
        await validateCacheArchive(next)
        fs.renameSync(next, file)
        cache.savedBytes = info.size
      } catch {
        cache.publish = 'skipped'
      } finally {
        fs.rmSync(next, { force: true })
      }
    }
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
        '--retry-of',
        '--platform',
        '--run-id',
        '--cache-dir',
        '--cache-scope'
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
      'Review the exact commit, immutable runtime and installation scripts before running CI.'
    )
  if (!/^[a-f0-9-]{36}$/.test(flags['--run-id'] || ''))
    throw new Error('A server-owned run identity is required.')
  const approved = (flags['--approve'] || '').split(',')
  if (approved.join(',') !== 'lint,test,build')
    throw new Error(
      'This reviewed CI profile requires lint, test and build in order.'
    )
  if (
    !approved.length ||
    approved.some((name) => !['test', 'build', 'lint'].includes(name)) ||
    new Set(approved).size !== approved.length
  )
    throw new Error(
      'Only reviewed test, build and optional lint scripts are supported by this executor.'
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
          /(^|\/)(\.env(?:\.[^/]+)?|\.tmp|\.npm-cache|node_modules|db)(\/|$)|\.(?:sqlite|db|db-wal|db-shm)$/.test(
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
    docker.OSType !== 'linux' ||
    (process.env.DOCKER_HOST && !process.env.DOCKER_HOST.startsWith('unix://'))
  )
    throw new Error('Server CI requires the local Linux Docker daemon.')
  const available =
    Number(
      fs
        .readFileSync('/proc/meminfo', 'utf8')
        .match(/^MemAvailable:\s+(\d+) kB/m)?.[1]
    ) * 1024
  if (!Number.isFinite(available) || available < 5 * 1024 ** 3)
    throw new Error(
      'Server CI needs 4 GiB plus 1 GiB of available host memory; the live application is unchanged.'
    )
  output = path.resolve(flags['--out'])
  if (fs.existsSync(output))
    throw new Error(
      'Choose a new evidence directory; existing runs are immutable.'
    )
  fs.mkdirSync(output, { recursive: true, mode: 0o700 })
  if (!['linux/amd64', 'linux/arm64'].includes(flags['--platform']))
    throw new Error(
      'Specify the reviewed --platform linux/amd64 or linux/arm64.'
    )
  const image = {
    Os: 'linux',
    Architecture: flags['--platform'].split('/')[1],
    Id: null,
    Size: 0
  }

  const id = flags['--run-id']
  container = `slipway-ci-server-${id}`
  const started = performance.now()
  deadline = Date.now() + 1200000
  const configuration = contract.configuration(
    manifest,
    flags['--image'],
    flags['--platform'] || 'linux/' + image.Architecture
  )
  const platform = configuration.platform

  report = {
    formatVersion: 1,
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
    configRevision: contract.digest(configuration),
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
    await checked(
      'docker',
      [
        'run',
        '--platform',
        platform,
        '--pull',
        'missing',
        '-d',
        '--name',
        container,
        '--label',
        `slipway.ci.server=${id}`,
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
        'npm_config_cache=/workspace/.npm-cache',
        '--env',
        'npm_config_update_notifier=false',
        '--env',
        'npm_config_audit=false',
        '--env',
        'npm_config_fund=false',
        '--env',
        'npm_config_jobs=2',
        '--env',
        'DATABASE_PATH=.tmp/db/test.sqlite',
        flags['--image'],
        'node',
        '-e',
        'setTimeout(()=>process.exit(124),1200000)'
      ],
      { timeout: 180000 }
    )
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
    const selectedImageId = await checked('docker', [
      'inspect',
      container,
      '--format',
      '{{.Image}}'
    ])
    const selectedImage = JSON.parse(
      await checked('docker', [
        'image',
        'inspect',
        selectedImageId,
        '--format',
        '{{json .}}'
      ])
    )
    if (
      'linux/' + selectedImage.Architecture !== platform ||
      selectedImage.Os !== 'linux'
    )
      throw new Error(
        'The server runtime platform does not match the reviewed policy.'
      )
    report.runtime.imageId = selectedImage.Id
    report.runtime.architecture = selectedImage.Architecture
    report.runtime.unpackedImageBytes = selectedImage.Size
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
        'The reviewed Sailsconf pilot profile requires Node 22.12 or newer on the 22.x line.'
      )
    const cache = await packageCache(flags, lock)
    report.state = 'running'
    save()
    const commands = [
      ['install', ['ci']],
      ...approved.map((name) => [name, ['run', name]])
    ]
    let before = await stats()
    for (const [name, args] of commands) {
      const stepStarted = performance.now()
      const step = { name, required: true, state: 'running' }
      report.steps.push(step)
      save()
      const result = await command(
        'docker',
        ['exec', container, 'npm', ...args],
        { log: `${name}.log`, timeout: 1200000, captureLimit: 0 }
      )
      step.durationSeconds =
        Math.round((performance.now() - stepStarted) / 10) / 100
      step.exitCode = result.code
      step.state = result.code === 0 ? 'passed' : 'failed'
      step.resources = await stats()
      step.resources.stepCpuSeconds =
        before.cpuSeconds != null && step.resources.cpuSeconds != null
          ? Math.max(0, step.resources.cpuSeconds - before.cpuSeconds)
          : null
      before = step.resources
      save()
      if (result.code !== 0) {
        const error = new Error(
          `${name} failed (exit ${result.code}); inspect private CI log and per-mount available bytes/inodes in resource evidence.`
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
        await cache.publish?.()
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
if (require.main === module)
  main().catch((error) => {
    process.stderr.write(error.message + '\n')
    process.exitCode = 1
  })
module.exports._private = { validateCacheArchive }
