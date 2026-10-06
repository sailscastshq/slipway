const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const ledger = require('./upgrade-ledger')
const { runBounded } = require('./upgrade-process')
const coordinator = require('./upgrade-coordinator')
const registry = require('./upgrade-registry')
const filenames = {
  default: 'app.db',
  observability: 'observability.db',
  analytics: 'analytics.db',
  cache: 'stash.db'
}
function fail(code = 'upgradeHostRecoveryRequired') {
  throw Object.assign(
    new Error('Host upgrade requires its exact reviewed recovery checkpoint.'),
    { code }
  )
}
function services(directory, instanceId) {
  return Object.entries(filenames).map(([datastore, filename]) => ({
    datastore,
    path: path.join(directory, filename),
    databaseKey: `${instanceId}:${datastore}`
  }))
}
function sync(filename) {
  const fd = fs.openSync(filename, 'r')
  try {
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
}
function save(filename, state, initial = false) {
  const temporary = initial
    ? filename
    : `${filename}.${crypto.randomUUID()}.tmp`
  fs.writeFileSync(
    temporary,
    JSON.stringify({ state, hash: ledger.digest(state) }),
    { mode: 0o600, flag: 'wx' }
  )
  sync(temporary)
  if (!initial) fs.renameSync(temporary, filename)
  sync(path.dirname(filename))
}
function read(filename) {
  const stat = fs.lstatSync(filename)
  if (
    !stat.isFile() ||
    (stat.mode & 0o777) !== 0o600 ||
    stat.size > 2 * 1024 * 1024
  )
    fail()
  try {
    const envelope = JSON.parse(fs.readFileSync(filename, 'utf8'))
    if (
      envelope.state?.format !== 1 ||
      envelope.hash !== ledger.digest(envelope.state)
    )
      fail()
    return envelope.state
  } catch {
    fail()
  }
}
function plan({
  sourceDirectory,
  instanceId,
  image,
  sourceVersion,
  containerId,
  containerName = 'slipway',
  previous
}) {
  if (
    (!['0.0.86', '0.0.87', 'fresh'].includes(sourceVersion) &&
      !(
        previous?.manifest.version === sourceVersion &&
        require('semver').lte(sourceVersion, registry.release)
      )) ||
    !instanceId ||
    !/^[a-f0-9]{64}$/.test(containerId || '') ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(containerName)
  )
    fail('upgradeHostTarget')
  const source = fs.realpathSync(sourceDirectory)
  const stat = fs.statSync(source)
  if (!stat.isDirectory()) fail('upgradeHostTarget')
  const identity = registry.createReleasePlan({
    services: services(source, instanceId),
    instanceId,
    image,
    mode: sourceVersion === 'fresh' ? 'fresh' : 'upgrade',
    previous
  })
  const value = {
    format: 1,
    sourceDirectory: source,
    sourceDevice: stat.dev,
    sourceInode: stat.ino,
    sourceVersion,
    containerId,
    containerName,
    instanceId,
    identity,
    ...(previous ? { previous } : {})
  }
  return { ...value, reviewHash: ledger.digest(value) }
}
function verifyPlan(reviewed, approval) {
  const { reviewHash, ...value } = reviewed
  if (approval !== reviewHash || reviewHash !== ledger.digest(value))
    fail('upgradeHostApproval')
  const current = plan({ ...value, image: value.identity.manifest.image })
  if (current.reviewHash !== reviewHash) fail('upgradeHostTarget')
}
// Driver functions are trusted host capabilities, never request-supplied code.
// Its acquisition must exclude all managed writer launches for this instance;
// physical writer observation alone is deliberately insufficient.
function prepare({
  reviewed,
  approval,
  directory,
  driver,
  timeoutMs,
  maxBytes,
  reserveBytes = 0
}) {
  verifyPlan(reviewed, approval)
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes <= 0 ||
    !Number.isSafeInteger(reserveBytes) ||
    reserveBytes < 0
  )
    fail('upgradeHostTarget')
  const folder = fs.mkdtempSync(path.join(fs.realpathSync(directory), 'host-'))
  fs.chmodSync(folder, 0o700)
  const filename = path.join(folder, 'host.json')
  const state = {
    format: 1,
    id: crypto.randomUUID(),
    reviewed,
    maxBytes,
    reserveBytes,
    phase: 'reviewed',
    stage: null,
    backupSet: null,
    handle: null,
    target: null
  }
  save(filename, state, true)
  return {
    filename,
    id: state.id,
    instanceId: reviewed.instanceId,
    reviewHash: reviewed.reviewHash,
    phase: state.phase,
    manifestHash: reviewed.identity.hash,
    targetVersion: reviewed.identity.manifest.version
  }
}
async function apply(options) {
  const accepted = prepare(options)
  return execute({
    filename: accepted.filename,
    driver: options.driver,
    timeoutMs: options.timeoutMs,
    expectedReviewHash: options.approval
  })
}

async function execute({ filename, driver, timeoutMs, expectedReviewHash }) {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > 60 * 60 * 1000 ||
    !driver ||
    ['acquire', 'freeze', 'verifyFence', 'publish', 'health', 'release'].some(
      (method) => typeof driver[method] !== 'function'
    )
  )
    fail()
  const state = read(filename)
  if (state.reviewed.reviewHash !== expectedReviewHash)
    fail('upgradeHostTarget')
  const deadline = Date.now() + timeoutMs
  const remaining = () => {
    const value = deadline - Date.now()
    if (value <= 0) fail('upgradeHostTimeout')
    return value
  }
  let control
  async function bounded(operation, input, extra = {}) {
    return runBounded({ operation, input, timeoutMs: remaining(), ...extra })
  }
  async function fence(targets, context, worker) {
    if (!worker && context?.workerPid) {
      worker = context
      context = undefined
    }
    const proof = await driver.verifyFence({
      control,
      targets,
      context,
      worker
    })
    if (
      proof?.id !== state.id ||
      proof.writersStopped !== true ||
      proof.exclusiveController !== true ||
      proof.controllerOwner !== control.owner ||
      ledger.digest([...(proof.databaseKeys || [])].sort()) !==
        ledger.digest(targets.map((item) => item.databaseKey).sort())
    )
      fail('upgradeFenceLost')
    return proof
  }
  async function checkpoint(phase) {
    state.phase = phase
    if (phase === 'ready') {
      delete state.errorCode
      delete state.errorReason
    }
    save(filename, state)
  }
  try {
    control = await driver.acquire({
      id: state.id,
      reviewed: state.reviewed,
      filename,
      deadline
    })
    if (!control?.owner) fail('upgradeFenceLost')
    state.actor = {
      kind: control.actor?.kind || 'host-root',
      uid: control.actor?.uid || 0,
      id: control.actor?.id || 0,
      team: control.actor?.team || 0
    }
    save(filename, state)
    await driver.freeze({ control, reviewed: state.reviewed })
    await fence(
      services(state.reviewed.sourceDirectory, state.reviewed.instanceId)
    )
    if (!state.stage) {
      // Revalidate native source after writers stop. Row changes during review
      // are permitted; schema/image/instance changes require a fresh review.
      verifyPlan(state.reviewed, expectedReviewHash)
      await checkpoint('staging')
      state.stage = await bounded('stageStorage', {
        source: state.reviewed.sourceDirectory,
        directory: path.dirname(filename),
        maxBytes: state.maxBytes,
        reserveBytes: state.reserveBytes
      })
      save(filename, state)
    }
    await bounded('verifySource', {
      stage: state.stage,
      maxBytes: state.maxBytes
    })
    const targets = services(
      state.stage.dataDirectory,
      state.reviewed.instanceId
    )
    await fence(targets)
    if (!state.backupSet) {
      state.backupSet = await bounded(
        'backup',
        {
          databases: targets,
          directory: state.stage.directory,
          maxBytes: state.maxBytes,
          reserveBytes: state.reserveBytes
        },
        { verifyFence: fence }
      )
      save(filename, state)
    }
    if (!state.handle) {
      const preflight = await bounded('preflight', {
        identity: state.reviewed.identity,
        backupSet: state.backupSet
      })
      state.handle = await bounded('prepare', {
        directory: state.stage.directory,
        identity: state.reviewed.identity,
        databases: targets,
        backupSet: state.backupSet,
        preflight,
        instanceId: state.reviewed.instanceId
      })
      await checkpoint('prepared')
    }
    await checkpoint('migrating')
    const result = await bounded(
      'run',
      {
        filename: state.handle.filename,
        owner: control.owner,
        expectedInstanceId: state.reviewed.instanceId,
        expectedManifestHash: state.reviewed.identity.hash,
        actor: { id: state.actor.id, team: state.actor.team || 0 }
      },
      {
        verifyFence: fence,
        audit: async (_actor, action, event) => {
          if (
            ![
              'migration.started',
              'migration.verified',
              'migration.applied',
              'migration.failed'
            ].includes(action)
          )
            fail()
          const record = {
            at: new Date().toISOString(),
            actor: state.actor,
            action,
            manifestHash: state.reviewed.identity.hash,
            planId: event.planId,
            reviewedHash: event.reviewedHash,
            executedHash: event.executedHash,
            operationIds: event.operationIds
          }
          const auditFile = path.join(path.dirname(filename), 'audit.ndjson')
          fs.appendFileSync(auditFile, JSON.stringify(record) + '\n', {
            mode: 0o600
          })
          sync(auditFile)
        }
      }
    )
    if (
      result.phase !== 'completed' ||
      !result.reconciled ||
      result.pending.length
    )
      fail()
    await bounded('verifySource', {
      stage: state.stage,
      maxBytes: state.maxBytes
    })
    await fence(targets)
    await checkpoint('verified')
    // Persist intent before calling Docker. The driver must reconcile target
    // identity after a crash, never start a second or restore the old image.
    await checkpoint('publishing')
    state.target = await driver.publish({ control, state, filename })
    save(filename, state)
    const health = await driver.health({
      control,
      state,
      remainingMs: remaining()
    })
    if (
      health?.ready !== true ||
      health.instanceId !== state.reviewed.instanceId ||
      health.manifestHash !== state.reviewed.identity.hash ||
      health.image !== state.reviewed.identity.manifest.image
    )
      fail('upgradeHostHealth')
    await checkpoint('ready')
    return status(filename)
  } catch (error) {
    state.phase = 'recoveryRequired'
    state.errorReason = require('./upgrade-fence-reasons').has(error.reason)
      ? error.reason
      : null
    state.errorCode = /^upgrade[A-Za-z]+$/.test(error.code || '')
      ? error.code
      : 'upgradeHostRecoveryRequired'
    save(filename, state)
    throw Object.assign(
      new Error(
        'Host upgrade is stopped. Resume this checkpoint; previous storage and backups are retained.'
      ),
      { code: state.errorCode, reason: state.errorReason, filename }
    )
  } finally {
    if (control) {
      try {
        await driver.release({ control, state, filename })
      } catch {
        state.phase = 'recoveryRequired'
        state.errorCode = 'upgradeHostCleanupRequired'
        save(filename, state)
        throw Object.assign(
          new Error(
            'Host upgrade cleanup requires this retained recovery checkpoint.'
          ),
          { code: state.errorCode, filename }
        )
      }
    }
  }
}
function status(filename) {
  const state = read(filename)
  let receipt = null
  if (state.handle) receipt = coordinator.status(state.handle.filename)
  return {
    filename,
    id: state.id,
    instanceId: state.reviewed.instanceId,
    image: state.reviewed.identity.manifest.image,
    reviewHash: state.reviewed.reviewHash,
    phase: state.phase,
    migration: receipt,
    recoveryRequired: state.phase === 'recoveryRequired',
    errorCode: state.errorCode || null,
    errorReason: state.errorReason || null
  }
}
module.exports = {
  plan,
  prepare,
  apply,
  resume: execute,
  status,
  read,
  services
}
