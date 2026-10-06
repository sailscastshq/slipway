// Disposable CI Docker daemon only. Exercise unmodified published 87 updater
// sources against the actual candidate image; never contact a production host.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const vm = require('node:vm')
const cp = require('node:child_process')
const { createRequire } = require('node:module')

const released =
  'ghcr.io/sailscastshq/slipway@sha256:85a4b573bb48c9e2567c3ac3b35b35955f8fcaa639da1a5dcbf219a6b14964c5'
const candidate = 'ghcr.io/fixture/slipway:candidate'
const expectedReceipt = {
  ready: true,
  version: '0.0.88',
  checksum: require('../../api/lib/migration-plans').digest(
    require('../../api/lib/releases/0.0.88.json')
  )
}
const artifact = path.resolve('.tmp/bosun-release-proof')
const volume = `bosun-proof-${process.pid}`
const freshVolume = `${volume}-fresh`
const containers = [
  'slipway',
  'slipway-next',
  'slipway-bosun',
  'slipway-previous',
  'bosun-proof-seed',
  'bosun-proof-fresh'
]
const docker = (args) =>
  cp.execFileSync('docker', args, {
    encoding: 'utf8',
    timeout: 300000,
    maxBuffer: 8 * 1024 * 1024
  })
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const secret = crypto.randomBytes(32).toString('hex')
const encryptionKey = crypto.randomBytes(32).toString('base64')
const env = [
  '-e',
  `SESSION_SECRET=${secret}`,
  '-e',
  `DATA_ENCRYPTION_KEY=${encryptionKey}`,
  '-e',
  'SLIPWAY_SETUP_TOKEN=test-only-claim-token',
  '-e',
  'SLIPWAY_APP_PORT_HOST=127.0.0.1',
  '-e',
  'SLIPWAY_SSL=false'
]
const proof = {
  sourceHead: cp
    .execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' })
    .trim(),
  released,
  substitutions: [
    'Unreleased candidate image acquisition uses the already built local image instead of a registry pull.',
    'Release discovery, optional remote backup, progress cache and port allocation use fixture adapters. Published update/swap/mount/health source control flow is unchanged.'
  ],
  sourceHashes: {},
  stages: []
}
let scopeOwned = false
const redact = (text) =>
  String(text)
    .split(secret)
    .join('[REDACTED]')
    .split(encryptionKey)
    .join('[REDACTED]')
    .replace(/test-only-claim-token/g, '[TEST CLAIM TOKEN]')

async function health(name, expected = 'ok', timeout = 90000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      const result = JSON.parse(
        docker([
          'exec',
          name,
          'curl',
          '-fsS',
          '--max-time',
          '3',
          'http://localhost:1337/health'
        ])
      )
      if (result.status === expected) return result
    } catch {}
    await wait(1000)
  }
  throw new Error(`Normal startup health failed for ${name}`)
}

function loadPublished(relative) {
  const filename = path.join(artifact, relative)
  const code = fs.readFileSync(filename, 'utf8')
  proof.sourceHashes[relative] = crypto
    .createHash('sha256')
    .update(code)
    .digest('hex')
  const localRequire = createRequire(filename)
  const requireAdapter = (name) => {
    if (name !== 'child_process') return localRequire(name)
    const execFile = (...args) => {
      if (
        args[0] === 'docker' &&
        args[1][0] === 'pull' &&
        args[1][1] === candidate
      ) {
        const callback = args.at(-1)
        queueMicrotask(() =>
          callback(null, 'locally built exact candidate image', '')
        )
        return {}
      }
      return cp.execFile(...args)
    }
    // util.promisify must preserve execFile's stdout/stderr return contract.
    execFile[require('node:util').promisify.custom] = async (...args) => {
      if (
        args[0] === 'docker' &&
        args[1][0] === 'pull' &&
        args[1][1] === candidate
      )
        return { stdout: 'locally built exact candidate image', stderr: '' }
      return require('node:util').promisify(cp.execFile)(...args)
    }
    return { ...cp, execFile }
  }
  const module = { exports: {} }
  vm.runInNewContext(
    code,
    {
      require: requireAdapter,
      module,
      exports: module.exports,
      sails: global.sails,
      Buffer,
      process,
      console,
      setTimeout,
      clearTimeout
    },
    { filename }
  )
  return module.exports
}

async function main() {
  fs.mkdirSync(artifact, { recursive: true })
  assert.equal(
    process.env.CI,
    'true',
    'This test only runs in a disposable CI Docker daemon'
  )
  for (const name of containers)
    assert.equal(
      docker(['ps', '-aq', '--filter', `name=^/${name}$`]).trim(),
      '',
      'Proof requires an isolated disposable Docker daemon'
    )
  scopeOwned = true
  docker(['pull', released])
  proof.candidateImage = JSON.parse(
    docker(['image', 'inspect', candidate])
  )[0].Id
  docker(['volume', 'create', volume])
  docker(['volume', 'create', freshVolume])
  docker([
    'run',
    '-d',
    '--name',
    'bosun-proof-seed',
    '-v',
    '/var/run/docker.sock:/var/run/docker.sock',
    '-v',
    `${volume}:/app/db`,
    ...env,
    '-e',
    'NODE_ENV=development',
    released,
    'node',
    'app.js'
  ])
  await health('bosun-proof-seed')
  for (const relative of [
    'api/helpers/system/apply-update.js',
    'api/helpers/system/build-update-docker-args.js',
    'api/helpers/system/build-update-swap-script.js',
    'api/helpers/system/get-update-image-ref.js',
    'api/helpers/docker/health-check-container.js'
  ]) {
    fs.mkdirSync(path.dirname(path.join(artifact, relative)), {
      recursive: true
    })
    docker([
      'cp',
      `bosun-proof-seed:/app/${relative}`,
      path.join(artifact, relative)
    ])
  }
  docker(['rm', '-f', 'bosun-proof-seed'])
  docker([
    'run',
    '--rm',
    '-v',
    `${volume}:/app/db`,
    candidate,
    'node',
    '-e',
    `const D=require('better-sqlite3');const d=new D('/app/db/app.db');d.exec("INSERT INTO users (id,email,is_genesis_user,auth_version) VALUES (1,'founder@example.test','true','founder-session-version'); INSERT INTO settings (key,value) VALUES ('installationCompleted','true'); CREATE TABLE custom_notes(value TEXT); INSERT INTO custom_notes VALUES ('preserved');");d.close()`
  ])
  docker([
    'run',
    '-d',
    '--name',
    'slipway',
    '-v',
    '/var/run/docker.sock:/var/run/docker.sock',
    '-v',
    `${volume}:/app/db`,
    ...env,
    '-e',
    'NODE_ENV=production',
    released
  ])
  await health('slipway')
  proof.stages.push(
    'Published 87 production server is healthy with the original database volume and founder.'
  )
  const wrap = (relative) => ({
    with: (input) => {
      const helper = loadPublished(relative)
      const defaults = Object.fromEntries(
        Object.entries(helper.inputs || {})
          .filter(([, definition]) => Object.hasOwn(definition, 'defaultsTo'))
          .map(([name, definition]) => [name, definition.defaultsTo])
      )
      return helper.fn({ ...defaults, ...input })
    }
  })
  global.sails = {
    config: {
      custom: {
        slipwayAppsDir: '/var/slipway/apps',
        slipwayPortHost: '127.0.0.1'
      },
      slipway: { githubRepo: 'fixture/slipway' }
    },
    cache: { set: async () => {} },
    log: {
      info: (message) => console.log(redact(message)),
      warn: (message) => console.log(redact(message)),
      error: (message) => console.error(redact(message))
    },
    helpers: { system: {}, docker: {} }
  }
  Object.assign(global.sails.helpers.system, {
    checkForUpdates: async () => ({
      updateAvailable: true,
      currentVersion: '0.0.87',
      latestVersion: 'candidate'
    }),
    backupDatabase: async () => null,
    getUpdateImageRef: wrap('api/helpers/system/get-update-image-ref.js'),
    buildUpdateDockerArgs: wrap(
      'api/helpers/system/build-update-docker-args.js'
    ),
    buildUpdateSwapScript: wrap(
      'api/helpers/system/build-update-swap-script.js'
    )
  })
  Object.assign(global.sails.helpers.docker, {
    allocatePort: { with: async () => 19997 },
    releasePort: { with: async () => {} },
    healthCheckContainer: {
      with: async (input) => {
        const result = await loadPublished(
          'api/helpers/docker/health-check-container.js'
        ).fn({
          interval: 1000,
          ...input
        })
        proof.validation = JSON.parse(
          docker([
            'exec',
            'slipway-next',
            'curl',
            '-fsS',
            'http://localhost:1337/health'
          ])
        )
        assert.equal(proof.validation.mode, 'preflight')
        assert.equal(proof.validation.normalStartupReady, false)
        assert.equal(
          JSON.parse(docker(['inspect', 'slipway']))[0].State.Running,
          true
        )
        const receipt = docker([
          'exec',
          'slipway',
          'node',
          '-e',
          "const D=require('better-sqlite3');const d=new D('/app/db/app.db',{readonly:true});console.log(JSON.stringify(d.prepare(\"SELECT name FROM sqlite_schema WHERE name='_slipway_release_migrations'\").get()||null));d.close()"
        ])
        assert.equal(JSON.parse(receipt), null)
        proof.stages.push(
          'Candidate clone preflight passed while the original server remained running; no live release receipt or Sails lift occurred.'
        )
        return result
      }
    }
  })
  const result = await loadPublished('api/helpers/system/apply-update.js').fn()
  assert.equal(result.status, 'updating')
  const deadline = Date.now() + 90000
  const swapStartedAt = Date.now()
  while (Date.now() < deadline) {
    try {
      const info = JSON.parse(docker(['inspect', 'slipway']))[0]
      if (info.Image === proof.candidateImage) {
        fs.writeFileSync(
          path.join(artifact, 'candidate-startup.log'),
          redact(docker(['logs', 'slipway']))
        )
        await health('slipway')
        break
      }
    } catch {}
    await wait(1000)
  }
  assert.equal(
    JSON.parse(docker(['inspect', 'slipway']))[0].Image,
    proof.candidateImage
  )
  proof.health = await health('slipway')
  assert.deepEqual(proof.health.releaseMigrations, expectedReceipt)
  proof.swapToHealthyMilliseconds = Date.now() - swapStartedAt
  const verified = JSON.parse(
    docker([
      'exec',
      'slipway',
      'node',
      '-e',
      `const D=require('better-sqlite3');const d=new D('/app/db/app.db',{readonly:true});console.log(JSON.stringify({founder:d.prepare('SELECT auth_version FROM users WHERE id=1').get().auth_version,custom:d.prepare('SELECT value FROM custom_notes').get().value,receipt:d.prepare('SELECT version,checksum FROM _slipway_release_migrations').get(),backups:require('fs').readdirSync('/app/db/migration-backups').length}));d.close()`
    ])
  )
  assert.equal(verified.founder, 'founder-session-version')
  assert.equal(verified.custom, 'preserved')
  assert.equal(verified.receipt.version, '0.0.88')
  assert.ok(verified.backups > 0)
  proof.verified = verified
  proof.stages.push(
    'Unmodified published 87 validation and Bosun swap reached actual candidate normal startup; founder/custom data and durable migration receipt verified.'
  )
  docker([
    'run',
    '-d',
    '--name',
    'bosun-proof-fresh',
    '-v',
    '/var/run/docker.sock:/var/run/docker.sock',
    '-v',
    `${freshVolume}:/app/db`,
    ...env,
    '-e',
    'NODE_ENV=production',
    candidate
  ])
  proof.freshHealth = await health('bosun-proof-fresh')
  assert.deepEqual(proof.freshHealth.releaseMigrations, expectedReceipt)
  proof.stages.push(
    'Fresh production image boots directly on an empty named volume without a host bundle or development seed.'
  )
}

main()
  .then(() => {
    proof.success = true
  })
  .catch((error) => {
    proof.success = false
    proof.error = redact(error.message)
    console.error(proof.error)
    process.exitCode = 1
  })
  .finally(() => {
    for (const name of scopeOwned ? containers : []) {
      try {
        fs.writeFileSync(
          path.join(artifact, `${name}.log`),
          redact(docker(['logs', name]))
        )
      } catch {}
      try {
        docker(['rm', '-f', name])
      } catch {}
    }
    for (const name of scopeOwned ? [volume, freshVolume] : [])
      try {
        docker(['volume', 'rm', name])
      } catch {}
    fs.mkdirSync(artifact, { recursive: true })
    fs.writeFileSync(
      path.join(artifact, 'proof.json'),
      JSON.stringify(proof, null, 2) + '\n'
    )
  })
