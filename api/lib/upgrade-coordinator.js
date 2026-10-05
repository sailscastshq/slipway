const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const ledger = require('./upgrade-ledger')
const executeStep = require('./upgrade-execution')
const { verifyBackupSet } = require('./upgrade-backups')
const readSchema = require('./sqlite-schema')

function fail(message, code = 'upgradeRecoveryRequired') {
  const error = new Error(message)
  error.code = code
  throw error
}
function sync(filename) {
  const fd = fs.openSync(filename, 'r')
  try {
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
}
function writeJournal(filename, state, initial = false) {
  const envelope = { state, checksum: ledger.digest(state) }
  const temporary = initial
    ? filename
    : `${filename}.${crypto.randomUUID()}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(envelope), {
    mode: 0o600,
    flag: 'wx'
  })
  sync(temporary)
  if (!initial) fs.renameSync(temporary, filename)
  sync(path.dirname(filename))
}
function readJournal(filename) {
  const stat = fs.lstatSync(filename)
  if (
    !stat.isFile() ||
    (stat.mode & 0o777) !== 0o600 ||
    stat.size > 1024 * 1024
  )
    fail('Upgrade journal is not a private bounded file.')
  const envelope = JSON.parse(fs.readFileSync(filename, 'utf8'))
  if (
    envelope.state?.format !== 1 ||
    ledger.digest(envelope.state) !== envelope.checksum
  )
    fail('Upgrade journal is corrupt.')
  const verified = ledger.createManifest(envelope.state.identity.manifest)
  if (verified.hash !== envelope.state.identity.hash)
    fail('Upgrade journal manifest changed.')
  return envelope.state
}
function recordTarget(source) {
  const filename = fs.realpathSync(source.path)
  const stat = fs.statSync(filename)
  if (!stat.isFile()) fail('Upgrade target is not a database file.')
  return {
    datastore: source.datastore,
    path: filename,
    databaseKey: source.databaseKey,
    device: stat.dev,
    inode: stat.ino
  }
}
function services(state) {
  return state.targets.map((target) => {
    const current = recordTarget(target)
    if (ledger.digest(current) !== ledger.digest(target))
      fail('An upgrade target was replaced or moved.')
    return { ...target, type: 'sqlite' }
  })
}
function observe(state) {
  const applied = new Set()
  for (const service of services(state)) {
    const steps = state.identity.manifest.steps.filter(
      (step) => step.datastore === service.datastore
    )
    if (!steps.length) fail('An upgrade target has no manifest policy.')
    const checkpoint = ledger.inspectState(
      service,
      state.identity,
      service.databaseKey
    )
    checkpoint.receipts.forEach((receipt) => {
      if (
        receipt.backupId !== state.backupSet.id ||
        receipt.fenceId !== state.fenceId
      )
        fail('An upgrade receipt belongs to a different recovery set or fence.')
      applied.add(receipt.stepId)
    })
  }
  const steps = state.identity.manifest.steps
  const observed = steps
    .filter((step) => applied.has(step.id))
    .map((step) => step.id)
  if (observed.some((id, index) => id !== steps[index].id))
    fail('Cross-database receipts do not form the reviewed global prefix.')
  if (state.applied.some((id, index) => id !== observed[index]))
    fail('The upgrade journal claims a step absent from its database ledger.')
  return observed
}
async function prepareRun({
  directory,
  identity,
  databases,
  backupSet,
  preflight,
  timeoutMs,
  instanceId
}) {
  const verified = ledger.createManifest(identity.manifest)
  if (
    identity.hash !== verified.hash ||
    !instanceId ||
    (identity.manifest.instanceId &&
      identity.manifest.instanceId !== instanceId) ||
    preflight?.dryRun !== true ||
    preflight.manifestHash !== identity.hash ||
    preflight.backupId !== backupSet.id ||
    preflight.steps?.length !== identity.manifest.steps.length ||
    preflight.steps.some(
      (step, index) =>
        step.stepId !== identity.manifest.steps[index].id ||
        !['verifiedOnClone', 'alreadyApplied'].includes(step.outcome)
    )
  )
    fail('Upgrade run requires the exact verified clone preflight.')
  const receipt = await verifyBackupSet(backupSet, timeoutMs)
  const targets = databases.map(recordTarget)
  if (
    new Set(targets.map((target) => target.datastore)).size !==
      targets.length ||
    new Set(targets.map((target) => target.path)).size !== targets.length
  )
    fail('Upgrade targets are duplicated.')
  const expected = new Set(
    identity.manifest.steps.map((step) => step.datastore)
  )
  if (
    targets.length !== expected.size ||
    targets.some((target) => !expected.has(target.datastore))
  )
    fail('Upgrade targets do not cover the complete manifest.')
  for (const target of targets) {
    const snapshot = receipt.snapshots.find(
      (item) =>
        item.datastore === target.datastore &&
        item.databaseKey === target.databaseKey
    )
    const schema = readSchema(target)
    if (
      !snapshot ||
      schema.error ||
      ledger.digest(schema.tables) !== snapshot.schemaHash
    )
      fail('Upgrade target differs from its final recovery snapshot.')
  }
  const folder = fs.mkdtempSync(path.join(fs.realpathSync(directory), 'run-'))
  fs.chmodSync(folder, 0o700)
  const filename = path.join(folder, 'run.json')
  const state = {
    format: 1,
    id: crypto.randomUUID(),
    instanceId,
    identity: verified,
    targets,
    backupSet: { directory: backupSet.directory, id: backupSet.id },
    fenceId: receipt.fenceId,
    phase: 'prepared',
    applied: [],
    revision: 0
  }
  observe(state)
  writeJournal(filename, state, true)
  return { filename, id: state.id }
}
function status(filename) {
  const state = readJournal(filename)
  const applied = observe(state)
  return {
    id: state.id,
    instanceId: state.instanceId,
    version: state.identity.manifest.version,
    image: state.identity.manifest.image,
    manifestHash: state.identity.hash,
    phase: state.phase,
    applied,
    pending: state.identity.manifest.steps
      .slice(applied.length)
      .map((step) => step.id),
    reconciled: ledger.digest(applied) === ledger.digest(state.applied)
  }
}
async function run({
  filename,
  owner,
  verifyFence,
  preparePlan,
  timeoutMs,
  audit = async () => {},
  afterCheckpoint = async () => {},
  expectedInstanceId,
  expectedManifestHash,
  actor = { id: 0, team: 0 }
}) {
  if (
    !owner ||
    !Number.isSafeInteger(actor?.id) ||
    actor.id < 0 ||
    !Number.isSafeInteger(actor?.team) ||
    actor.team < 0 ||
    typeof verifyFence !== 'function' ||
    typeof preparePlan !== 'function' ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0
  )
    fail(
      'Upgrade run requires an exclusive owner, fence, registry and deadline.'
    )
  let state = readJournal(filename)
  if (
    state.instanceId !== expectedInstanceId ||
    state.identity.hash !== expectedManifestHash
  )
    fail('Upgrade run does not match the requested instance and manifest.')
  const deadline = Date.now() + timeoutMs
  function remaining() {
    const left = deadline - Date.now()
    if (left <= 0) fail('Upgrade coordinator exceeded its deadline.')
    return left
  }
  async function fence(previousOwner) {
    let timer
    let proof
    try {
      proof = await Promise.race([
        verifyFence(services(state), { owner, previousOwner }),
        new Promise((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error('Upgrade fence verification exceeded its deadline.')
              ),
            remaining()
          )
        })
      ])
    } finally {
      clearTimeout(timer)
    }
    if (
      proof?.id !== state.fenceId ||
      proof.writersStopped !== true ||
      proof.exclusiveController !== true ||
      proof.controllerOwner !== owner ||
      ledger.digest([...(proof.databaseKeys || [])].sort()) !==
        ledger.digest(
          state.targets.map((target) => target.databaseKey).sort()
        ) ||
      (previousOwner && proof.previousOwnerStopped !== true)
    )
      fail(
        'The exclusive upgrade controller or stopped writers could not be proved.',
        'upgradeFenceLost'
      )
    remaining()
  }
  const lockPath = filename + '.lock'
  const lockTemporary = `${lockPath}.${crypto.randomUUID()}.tmp`
  fs.writeFileSync(lockTemporary, JSON.stringify({ owner, runId: state.id }), {
    flag: 'wx',
    mode: 0o600
  })
  sync(lockTemporary)
  try {
    // Linking a complete private file is exclusive and atomic. A crash cannot
    // expose an empty lock whose previous owner is impossible to identify.
    fs.linkSync(lockTemporary, lockPath)
  } catch (error) {
    try {
      if (error.code !== 'EEXIST') throw error
      const previous = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
      if (previous.owner === owner || previous.runId !== state.id)
        fail(
          'Upgrade lock is already owned or belongs to another run.',
          'upgradeBusy'
        )
      // Reclaim is permitted only under the independently proved exclusive
      // controller fence, never from lease expiry or a local PID alone.
      await fence(previous.owner)
      const again = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
      if (ledger.digest(again) !== ledger.digest(previous))
        fail('Upgrade lock owner changed.', 'upgradeBusy')
      fs.unlinkSync(lockPath)
      fs.linkSync(lockTemporary, lockPath)
    } finally {
      fs.rmSync(lockTemporary, { force: true })
    }
  }
  fs.rmSync(lockTemporary, { force: true })
  sync(path.dirname(filename))
  try {
    await fence()
    const latest = readJournal(filename)
    const immutable = (record) => ({
      id: record.id,
      instanceId: record.instanceId,
      identity: record.identity,
      targets: record.targets,
      backupSet: record.backupSet,
      fenceId: record.fenceId
    })
    if (ledger.digest(immutable(latest)) !== ledger.digest(immutable(state)))
      fail(
        'Upgrade journal identity changed while acquiring its controller lock.'
      )
    state = latest
    const observed = observe(state)
    state.applied = observed
    // If all SQL committed before a crash, reconcile the journal without DDL.
    if (observed.length < state.identity.manifest.steps.length)
      await verifyBackupSet(state.backupSet, remaining())
    state.phase = 'running'
    state.revision++
    writeJournal(filename, state)
    const source = {
      version: state.identity.manifest.version,
      image: state.identity.manifest.image
    }
    for (const step of state.identity.manifest.steps.slice(observed.length)) {
      await fence()
      const service = services(state).find(
        (target) => target.datastore === step.datastore
      )
      let timer
      let prepared
      try {
        prepared = await Promise.race([
          preparePlan({ step, service, source }),
          new Promise((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new Error('Upgrade plan registry exceeded its deadline.')
                ),
              remaining()
            )
          })
        ])
      } finally {
        clearTimeout(timer)
      }
      remaining()
      const result = await executeStep({
        prepared,
        identity: state.identity,
        step,
        service,
        databaseKey: service.databaseKey,
        backupId: state.backupSet.id,
        fenceId: state.fenceId,
        remaining,
        audit,
        actor,
        beforeCommit: async () => {
          await fence()
        }
      })
      state.applied = observe(state)
      state.revision++
      state.phase = result.success ? 'running' : 'recoveryRequired'
      writeJournal(filename, state)
      await afterCheckpoint({
        stepId: step.id,
        applied: [...state.applied],
        outcome: result.outcome || 'committed'
      })
      if (!result.success)
        fail(
          'The upgrade requires reconciliation before continuing.',
          result.code
        )
    }
    await fence()
    state.applied = observe(state)
    if (state.applied.length !== state.identity.manifest.steps.length)
      fail('Upgrade has incomplete database receipts.')
    state.phase = 'completed'
    state.revision++
    writeJournal(filename, state)
    return status(filename)
  } catch (error) {
    try {
      state.applied = observe(state)
    } catch (observationError) {
      state.observationError =
        observationError.code || 'upgradeRecoveryRequired'
    }
    state.phase = 'recoveryRequired'
    state.revision++
    writeJournal(filename, state)
    throw error
  } finally {
    const current = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
    if (current.owner === owner) fs.unlinkSync(lockPath)
    sync(path.dirname(filename))
  }
}
module.exports = { prepareRun, run, status, readJournal }
