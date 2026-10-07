// Real Docker upgrade proof using sanitized schema metadata from the affected
// legacy installation. All containers/volumes are owned by this test. The one
// fixed validation name is required by released startup and is reserved only
// after confirming it is unused. Existing local installations stay untouched.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const cp = require('node:child_process')
const assert = require('node:assert/strict')

const released =
  'ghcr.io/sailscastshq/slipway@sha256:85a4b573bb48c9e2567c3ac3b35b35955f8fcaa639da1a5dcbf219a6b14964c5'
const failed =
  process.env.SLIPWAY_FAILED_IMAGE ||
  'ghcr.io/sailscastshq/slipway@sha256:b3988167fcce5c6507c71ece77e647f65a50235ab874c5cceb70318eccfbff8d'
const candidate =
  process.env.SLIPWAY_CANDIDATE_IMAGE || 'ghcr.io/fixture/slipway:candidate'
const scope = `legacy-update-${process.pid}`
const label = `slipway.legacy-proof=${scope}`
const main = `${scope}-main`
const previous = `${scope}-previous`
const volume = `${scope}-db`
const bad = `${scope}-unhealthy`
const artifact = path.resolve('.tmp/legacy-update-proof')
const fixtures = path.resolve(
  process.env.SLIPWAY_PROOF_FIXTURES || 'tests/prelift/fixtures'
)
const secrets = [
  crypto.randomBytes(32).toString('hex'),
  crypto.randomBytes(32).toString('base64')
]
const env = [
  '-e',
  `SESSION_SECRET=${secrets[0]}`,
  '-e',
  `DATA_ENCRYPTION_KEY=${secrets[1]}`,
  '-e',
  'SLIPWAY_SETUP_TOKEN=fixture-only',
  '-e',
  'SLIPWAY_SSL=false',
  '-e',
  'NODE_ENV=production'
]
const owned = new Set()
let ownsVolume = false
let ownsBad = false
const redact = (text) =>
  secrets
    .reduce(
      (result, value) => result.split(value).join('[REDACTED]'),
      String(text)
    )
    .replaceAll('fixture-only', '[TEST CLAIM]')
const docker = (args, options = {}) =>
  cp.execFileSync('docker', args, {
    encoding: 'utf8',
    timeout: 300000,
    maxBuffer: 8 * 1024 * 1024,
    ...options
  })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const proof = {
  released,
  failed,
  candidate,
  schemaOnlySource: true,
  customerRowsUsed: false,
  stages: []
}
const inspect = (name) => JSON.parse(docker(['inspect', name]))[0]
function logs(name) {
  const result = cp.spawnSync('docker', ['logs', name], {
    encoding: 'utf8',
    timeout: 15000,
    maxBuffer: 8 * 1024 * 1024
  })
  return redact((result.stdout || '') + (result.stderr || ''))
}
const runArgs = (name, image) => [
  'run',
  '-d',
  '--platform',
  'linux/amd64',
  '--name',
  name,
  '--label',
  label,
  '-v',
  '/var/run/docker.sock:/var/run/docker.sock',
  '-v',
  `${volume}:/app/db`,
  ...env,
  image
]

function reserve(name) {
  assert.equal(
    docker(['ps', '-aq', '--filter', `name=^/${name}$`]).trim(),
    '',
    `Container ${name} is already in use`
  )
  owned.add(name)
}

let workerSequence = 0
function worker(args) {
  const name = `${scope}-worker-${workerSequence++}`
  reserve(name)
  return docker(['run', '--rm', '--name', name, '--label', label, ...args])
}

function remove(name) {
  const ids = docker(['ps', '-aq', '--filter', `name=^/${name}$`]).trim()
  if (!ids) return
  assert.equal(inspect(name).Config.Labels?.['slipway.legacy-proof'], scope)
  docker(['rm', '-f', name])
}

async function until(check, timeout = 120000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    try {
      if (await check()) return
    } catch {}
    await sleep(1000)
  }
  throw new Error('Disposable Docker proof timed out')
}

async function health(name, expected = 'ok') {
  let result
  await until(() => {
    result = JSON.parse(
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
    return expected === 'preflight'
      ? result.mode === expected
      : result.status === expected
  })
  return result
}

function data() {
  const code = `const D=require('better-sqlite3');const a=new D('/app/db/app.db',{readonly:true});const o=new D('/app/db/observability.db',{readonly:true});const value={founder:a.prepare('SELECT email,auth_version FROM users WHERE id=1').get(),apps:a.prepare('SELECT * FROM apps WHERE id=1').get(),environment:a.prepare('SELECT * FROM environments WHERE id=1').get(),custom:a.prepare('SELECT * FROM custom_notes').all(),metric:o.prepare('SELECT * FROM container_metrics WHERE legacy_source_id=123').get(),schema:a.prepare("SELECT name,sql FROM sqlite_schema WHERE name IN ('apps','environments') ORDER BY name").all()};a.close();o.close();console.log(JSON.stringify(value));`
  return JSON.parse(
    worker([
      '--platform',
      'linux/amd64',
      '-v',
      `${volume}:/app/db:ro`,
      candidate,
      'node',
      '-e',
      code
    ])
  )
}

function receipt() {
  return JSON.parse(
    docker([
      'exec',
      main,
      'node',
      '-e',
      `const d=new(require('better-sqlite3'))('/app/db/app.db',{readonly:true});console.log(JSON.stringify(d.prepare("SELECT name FROM sqlite_schema WHERE name='_slipway_release_migrations'").get()||null));d.close()`
    ])
  )
}

async function swap(image, name) {
  reserve(name)
  const helper = require(path.join(artifact, 'published-swap.cjs'))
  const code = await helper.fn({
    runArgs: runArgs(main, image),
    containerName: main,
    backupContainerName: previous
  })
  docker([
    'run',
    '-d',
    '--platform',
    'linux/amd64',
    '--name',
    name,
    '--label',
    label,
    '-v',
    '/var/run/docker.sock:/var/run/docker.sock',
    released,
    'node',
    '-e',
    code
  ])
}

async function execute() {
  fs.mkdirSync(artifact, { recursive: true })
  for (const name of [main, previous, 'slipway-next']) reserve(name)
  assert.equal(
    docker(['volume', 'ls', '-q', '--filter', `name=^${volume}$`]).trim(),
    ''
  )
  docker(['volume', 'create', '--label', label, volume])
  ownsVolume = true
  worker([
    '--platform',
    'linux/amd64',
    ...env,
    '-e',
    'NODE_PATH=/app/node_modules',
    '-v',
    `${volume}:/app/db`,
    '-v',
    `${fixtures}:/fixtures:ro`,
    failed,
    'node',
    '-e',
    "require('/fixtures/seed-legacy-production.cjs')('/app/db')"
  ])
  docker(runArgs(main, released))
  proof.previousHealth = await health(main)
  docker([
    'cp',
    `${main}:/app/api/helpers/system/build-update-swap-script.js`,
    path.join(artifact, 'published-swap.cjs')
  ])
  proof.publishedSwapSourceSha256 = crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(artifact, 'published-swap.cjs')))
    .digest('hex')
  const before = data()
  proof.businessDataSha256 = crypto
    .createHash('sha256')
    .update(JSON.stringify(before))
    .digest('hex')
  assert.equal(receipt(), null)
  docker(runArgs('slipway-next', failed))
  await until(() => !inspect('slipway-next').State.Running)
  const failedLogs = logs('slipway-next')
  fs.writeFileSync(path.join(artifact, 'original-088-failure.log'), failedLogs)
  assert.match(failedLogs, /incompatible default\.apps schema/)
  assert.deepEqual(data(), before)
  assert.equal(receipt(), null)
  assert.equal(inspect(main).State.Running, true)
  remove('slipway-next')
  proof.stages.push(
    'Actual published 0.0.88 reproduced the reported default.apps rejection against the exact sanitized catalog; original 87 remained healthy and business data/receipts were unchanged.'
  )
  docker(runArgs('slipway-next', candidate))
  proof.preflightHealth = await health('slipway-next', 'preflight')
  assert.equal(proof.preflightHealth.normalStartupReady, false)
  assert.equal(inspect(main).State.Running, true)
  assert.deepEqual(data(), before)
  assert.equal(receipt(), null)
  remove('slipway-next')
  proof.stages.push(
    'Corrected candidate clone preflight passed while actual published 87 continued running; no live receipt or business-data change occurred.'
  )
  const imageId = inspect(main).Image
  proof.candidateImageId = JSON.parse(
    docker(['image', 'inspect', candidate])
  )[0].Id
  await swap(candidate, `${scope}-upgrade`)
  await until(() => inspect(main).Image !== imageId)
  proof.candidateHealth = await health(main)
  assert.equal(inspect(main).Image, proof.candidateImageId)
  assert.equal(proof.candidateHealth.releaseMigrations.version, '0.0.88')
  assert.equal(proof.candidateHealth.releaseMigrations.ready, true)
  assert.deepEqual(data(), before)
  await until(() => !inspect(`${scope}-upgrade`).State.Running)
  assert.equal(inspect(`${scope}-upgrade`).State.ExitCode, 0)
  proof.stages.push(
    'Unmodified published 87 Bosun swap helper upgraded the real legacy volume to healthy normal candidate startup; founder, every app/environment field, legacy metrics and custom rows/layouts matched their original fingerprint.'
  )
  docker(['restart', main])
  await health(main)
  assert.deepEqual(data(), before)
  proof.stages.push(
    'Normal corrected-image restart remained healthy and retained the same business-data fingerprint.'
  )
  docker(['build', '--platform', 'linux/amd64', '-t', bad, '-'], {
    input: `FROM ${candidate}\nCMD ["node","-e","setInterval(()=>{},1000)"]\n`
  })
  ownsBad = true
  const badId = JSON.parse(docker(['image', 'inspect', bad]))[0].Id
  await swap(bad, `${scope}-rollback`)
  await until(() => inspect(main).Image === badId)
  await until(() => !inspect(`${scope}-rollback`).State.Running, 150000)
  proof.rollbackHealth = await health(main)
  assert.equal(inspect(main).Image, proof.candidateImageId)
  assert.deepEqual(data(), before)
  const rollbackLogs = logs(`${scope}-rollback`)
  assert.match(rollbackLogs, /Rollback complete/)
  fs.writeFileSync(path.join(artifact, 'rollback.log'), rollbackLogs)
  proof.stages.push(
    'An unhealthy replacement failed the real published 87 health gate; the unchanged swap helper restored the previous healthy corrected candidate container and identical business data.'
  )
  console.log(proof.stages.join('\n'))
}

execute()
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
    for (const name of owned) {
      try {
        fs.writeFileSync(path.join(artifact, `${name}.log`), logs(name))
      } catch {}
      try {
        remove(name)
      } catch (error) {
        proof.cleanupError = redact(error.message)
        process.exitCode = 1
      }
    }
    if (ownsVolume)
      try {
        docker(['volume', 'rm', volume])
      } catch (error) {
        proof.cleanupError = redact(error.message)
        process.exitCode = 1
      }
    if (ownsBad)
      try {
        docker(['image', 'rm', bad])
      } catch {}
    fs.mkdirSync(artifact, { recursive: true })
    fs.writeFileSync(
      path.join(artifact, 'proof.json'),
      JSON.stringify(proof, null, 2) + '\n'
    )
  })
