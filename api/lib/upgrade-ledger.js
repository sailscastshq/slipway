const crypto = require('node:crypto')
const Database = require('better-sqlite3')
const readSchema = require('./sqlite-schema')
const { contract } = require('./migration-plans')

const table = '_slipway_upgrade_ledger_v1'
const ddl = `CREATE TABLE ${table} (
  manifest_hash TEXT NOT NULL,
  step_id TEXT NOT NULL,
  receipt TEXT NOT NULL,
  receipt_hash TEXT NOT NULL,
  PRIMARY KEY (manifest_hash, step_id)
)`
const hashPattern = /^[a-f0-9]{64}$/

function fail(message) {
  const error = new Error(message)
  error.code = 'upgradeLedgerMismatch'
  throw error
}
function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string')
    return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value))
    return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && Object.getPrototypeOf(value) === Object.prototype)
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`
  fail('Upgrade identity contains an unsupported value.')
}
function digest(value) {
  return crypto.createHash('sha256').update(canonical(value)).digest('hex')
}
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze)
    Object.freeze(value)
  }
  return value
}
function createManifest(input) {
  const manifest = JSON.parse(canonical(input))
  if (
    manifest.format !== 1 ||
    !/^\d+\.\d+\.\d+$/.test(manifest.version || '') ||
    !/^.+@sha256:[a-f0-9]{64}$/.test(manifest.image || '') ||
    !Array.isArray(manifest.steps) ||
    !manifest.steps.length
  )
    fail('Upgrade manifest requires a version, immutable image and steps.')
  const ids = new Set()
  const previous = new Map()
  for (const step of manifest.steps) {
    if (
      !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(step.id || '') ||
      ids.has(step.id) ||
      !['default', 'observability', 'analytics', 'cache'].includes(
        step.datastore
      ) ||
      !hashPattern.test(step.fromSchemaHash || '') ||
      !hashPattern.test(step.toSchemaHash || '') ||
      !hashPattern.test(step.operationsHash || '')
    )
      fail('Upgrade manifest has an invalid or duplicate step.')
    if (
      previous.has(step.datastore) &&
      previous.get(step.datastore) !== step.fromSchemaHash
    )
      fail('Upgrade manifest schema steps do not form a contiguous chain.')
    previous.set(step.datastore, step.toSchemaHash)
    ids.add(step.id)
  }
  return freeze({ manifest, hash: digest(manifest) })
}
function verifyLedger(db) {
  const existing = db
    .prepare('SELECT type, sql FROM sqlite_schema WHERE name = ?')
    .get(table)
  if (!existing) return false
  // An unknown object at this reserved name must never be silently adopted.
  if (existing.type !== 'table' || existing.sql !== ddl)
    fail('Upgrade ledger schema is incompatible.')
  const extra = db
    .prepare(
      "SELECT name FROM sqlite_schema WHERE tbl_name = ? AND type = 'trigger'"
    )
    .all(table)
  if (extra.length) fail('Upgrade ledger has unexpected triggers.')
  return true
}
function readLedger(db, identity, datastore, databaseKey) {
  const verified = createManifest(identity.manifest)
  if (verified.hash !== identity.hash)
    fail('Upgrade manifest identity changed.')
  if (!verifyLedger(db)) return []
  const steps = identity.manifest.steps.filter(
    (step) => step.datastore === datastore
  )
  const rows = db
    .prepare(`SELECT * FROM ${table} WHERE manifest_hash = ?`)
    .all(identity.hash)
  const receipts = rows.map((row) => {
    let receipt
    try {
      receipt = JSON.parse(row.receipt)
    } catch (_) {
      fail('Upgrade receipt is unreadable.')
    }
    const step = steps.find((item) => item.id === row.step_id)
    if (
      !step ||
      digest(receipt) !== row.receipt_hash ||
      receipt.manifestHash !== identity.hash ||
      receipt.databaseKey !== databaseKey ||
      receipt.stepHash !== digest(step) ||
      receipt.stepId !== step.id ||
      !receipt.fenceId ||
      !receipt.backupId
    )
      fail('Upgrade receipt does not match the reviewed upgrade.')
    return receipt
  })
  // No gaps: a crash can leave a committed prefix, never a later-only step.
  const ordered = steps.filter((step) =>
    receipts.some((item) => item.stepId === step.id)
  )
  if (ordered.some((step, index) => step.id !== steps[index].id))
    fail('Upgrade receipts are not a contiguous prefix.')
  return ordered.map((step) => receipts.find((item) => item.stepId === step.id))
}
function schemaHash(service) {
  const schema = readSchema(service)
  if (schema.error) fail('Upgrade schema could not be read.')
  delete schema.tables[table]
  if (Object.values(schema.tables).some((item) => !item.catalogComplete))
    fail('Upgrade schema has an unsupported native object.')
  return digest(schema.tables)
}
function inspectState(service, identity, databaseKey) {
  const borrowed = service.transaction?.database
  const db =
    borrowed ||
    new Database(service.path, { readonly: true, fileMustExist: true })
  try {
    const steps = identity.manifest.steps.filter(
      (step) => step.datastore === service.datastore
    )
    if (!steps.length)
      fail('The datastore is absent from the upgrade manifest.')
    const receipts = readLedger(db, identity, service.datastore, databaseKey)
    const expected = receipts.length
      ? steps[receipts.length - 1].toSchemaHash
      : steps[0].fromSchemaHash
    if (schemaHash({ ...service, transaction: { database: db } }) !== expected)
      fail('The physical schema differs from its upgrade checkpoint.')
    return {
      receipts,
      pending: steps.slice(receipts.length).map((step) => step.id),
      complete: receipts.length === steps.length
    }
  } finally {
    if (!borrowed) db.close()
  }
}
function receiptWriter({ identity, stepId, databaseKey, fenceId, backupId }) {
  const verified = createManifest(identity.manifest)
  if (verified.hash !== identity.hash)
    fail('Upgrade manifest identity changed.')
  const step = identity.manifest.steps.find((item) => item.id === stepId)
  if (
    !step ||
    !databaseKey ||
    !fenceId ||
    !backupId ||
    (step.databaseKey && step.databaseKey !== databaseKey)
  )
    fail('Upgrade receipt requires a reviewed step, target, fence and backup.')
  return ({ entry, service, database, before }) => {
    if (
      !database?.inTransaction ||
      service.datastore !== step.datastore ||
      entry.payload.target.physicalKey !== databaseKey
    )
      fail('Upgrade receipt must use the matching active schema transaction.')
    const beforeTables = { ...before.tables }
    delete beforeTables[table]
    if (
      digest(beforeTables) !== step.fromSchemaHash ||
      schemaHash(service) !== step.toSchemaHash ||
      digest(entry.selected.map(contract)) !== step.operationsHash
    )
      fail('Upgrade step differs from the immutable manifest.')
    const receipts = readLedger(database, identity, step.datastore, databaseKey)
    const steps = identity.manifest.steps.filter(
      (item) => item.datastore === step.datastore
    )
    if (steps[receipts.length]?.id !== step.id)
      fail('Upgrade step was already applied or is out of order.')
    if (!verifyLedger(database)) database.exec(ddl)
    const receipt = {
      format: 1,
      manifestHash: identity.hash,
      stepId,
      stepHash: digest(step),
      databaseKey,
      fenceId,
      backupId
    }
    database
      .prepare(`INSERT INTO ${table} VALUES (?, ?, ?, ?)`)
      .run(identity.hash, stepId, canonical(receipt), digest(receipt))
  }
}
module.exports = {
  createManifest,
  digest,
  schemaHash,
  inspectState,
  readLedger,
  receiptWriter,
  table
}
