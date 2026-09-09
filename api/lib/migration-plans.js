const crypto = require('node:crypto')
const plans = new Map()
const locks = new Set()
const lifetime = 5 * 60 * 1000

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
function contract(statement) {
  return {
    type: statement.type,
    table: statement.table,
    column: statement.column,
    sql: statement.sql
  }
}
function failure(message, code = 'invalidMigrationPlan') {
  const error = new Error(message)
  error.code = code
  return error
}
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value)
    Object.values(value).forEach(freeze)
  }
  return value
}

async function audit(actor, action, details, db) {
  const entry = {
    action,
    resourceType: 'migration',
    resourceId: details.planId,
    user: actor.id,
    team: actor.team,
    details
  }
  if (db) {
    // Bosun may be migrating the app database itself. Keep the audit insert
    // on that transaction rather than opening a second SQLite writer.
    const now = Date.now()
    db.prepare(
      'INSERT INTO audit_logs (action, resource_type, resource_id, user, team, details, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      action,
      'migration',
      details.planId,
      actor.id,
      actor.team,
      JSON.stringify(details),
      now,
      now
    )
  } else await AuditLog.create(entry)
}

function encryptedArchive(payload) {
  const keyId = 'default'
  const key = Buffer.from(
    sails.config.models.dataEncryptionKeys[keyId],
    'base64'
  )
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload)),
    cipher.final()
  ])
  return {
    keyId,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    tag: cipher.getAuthTag().toString('base64')
  }
}

async function create({ actor, target, models, source, schema, statements }) {
  for (const [id, entry] of plans)
    if (entry.expiresAt < Date.now()) plans.delete(id)
  if (plans.size >= 1000)
    throw failure(
      'Too many migration previews are open. Wait for earlier previews to expire.'
    )
  if (
    !statements.length ||
    statements.some((statement) => statement.blocked || !statement.table)
  )
    return null
  const id = crypto.randomUUID()
  const payload = JSON.parse(
    JSON.stringify({
      actorId: actor.id,
      teamId: actor.team,
      target,
      modelHash: digest(models),
      sourceHash: digest(source),
      schemaHash: digest(schema),
      models,
      statements
    })
  )
  const hash = digest(payload)
  const expiresAt = Date.now() + lifetime
  const operations = statements.map((statement, index) => ({
    ...statement,
    operationId: digest([id, index, contract(statement)])
  }))
  await audit(actor, 'migration.reviewed', {
    planId: id,
    hash,
    target: target.key,
    expiresAt,
    archive: encryptedArchive({ ...payload, operations })
  })
  plans.set(id, {
    payload: freeze(payload),
    hash,
    expiresAt,
    operations: freeze(JSON.parse(JSON.stringify(operations))),
    used: false
  })
  return { id, hash, expiresAt, statements: operations }
}

function claim({ id, hash, actor, target, operationIds }) {
  const entry = plans.get(id)
  if (!entry || entry.expiresAt <= Date.now())
    throw failure(
      'This migration preview expired. Refresh the schema comparison.',
      'expiredMigrationPlan'
    )
  if (
    entry.payload.actorId !== actor.id ||
    entry.payload.teamId !== actor.team ||
    digest(entry.payload.target) !== digest(target) ||
    entry.hash !== hash
  )
    throw failure(
      'This migration plan does not belong to this actor and database.'
    )
  if (entry.used)
    throw failure(
      'This migration plan has already been used. Refresh before trying again.',
      'usedMigrationPlan'
    )
  if (
    !Array.isArray(operationIds) ||
    !operationIds.length ||
    new Set(operationIds).size !== operationIds.length
  )
    throw failure('Select at least one complete table migration.')
  const selected = entry.operations.filter((operation) =>
    operationIds.includes(operation.operationId)
  )
  if (selected.length !== operationIds.length)
    throw failure('The selected operations are not in the reviewed plan.')
  const tables = new Set(selected.map((operation) => operation.table))
  if (
    entry.operations.some(
      (operation) =>
        tables.has(operation.table) &&
        !operationIds.includes(operation.operationId)
    )
  )
    throw failure('Select all reviewed operations for each table.')
  if (locks.has(target.physicalKey))
    throw failure(
      'A migration is already running for this database.',
      'migrationBusy'
    )
  entry.used = true
  locks.add(target.physicalKey)
  return {
    ...entry,
    id,
    selected,
    tables,
    release: () => locks.delete(target.physicalKey)
  }
}

function validate(entry, { models, source, schema, statements }) {
  if (
    entry.payload.modelHash !== digest(models) ||
    entry.payload.sourceHash !== digest(source) ||
    entry.payload.schemaHash !== digest(schema) ||
    digest(entry.payload.statements.map(contract)) !==
      digest(statements.map(contract))
  )
    throw failure(
      'The app or database changed after this preview. Refresh and review a new migration plan.',
      'staleMigrationPlan'
    )
}

module.exports = { create, claim, validate, audit, digest, contract, failure }
