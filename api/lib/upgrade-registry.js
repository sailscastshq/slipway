const Database = require('better-sqlite3')
const ledger = require('./upgrade-ledger')
const plans = require('./migration-plans')
const readSchema = require('./sqlite-schema')
const old = require('./upgrades/baselines/0.0.86.json')
const fresh = require('./upgrades/baselines/0.0.87.json')
const legacy = require('./upgrades/baselines/legacy-86-to-87.json')
const manual = require('./upgrades/baselines/bosun-86-to-87.json')
const current = require('./upgrades/baselines/current-fresh.json')
const release = '0.0.88'
const datastores = ['default', 'observability', 'analytics', 'cache']
const profiles = { old, fresh, legacy, manual }
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze)
    Object.freeze(value)
  }
  return value
}
Object.values(profiles).forEach(freeze)
freeze(current)
const operations = new Map()
function fail(message) {
  const error = new Error(message)
  error.code = 'upgradeUnsupportedSchema'
  throw error
}
function tables(profile, datastore) {
  return profile.databases[datastore]?.schema || {}
}
function body(table) {
  const { indexes: _, ...definition } = table
  return ledger.digest(definition)
}
function operation(profile, datastore, table, index) {
  const id = `${profile}.${datastore}.${table.name}.${
    index ? index.name : 'table'
  }`
  const statement = Object.freeze({
    datastore,
    type: index ? 'create_index' : 'create_table',
    table: table.name,
    column: null,
    sql: index ? index.sql : table.sql,
    risk: 'low'
  })
  operations.set(id, statement)
  return id
}
for (const [name, profile] of Object.entries(profiles))
  for (const datastore of datastores)
    for (const table of Object.values(tables(profile, datastore))) {
      operation(name, datastore, table)
      for (const index of table.indexes)
        if (index.sql) operation(name, datastore, table, index)
    }
const modeId = 'legacy.default.helm_history_entries.add_mode'
operations.set(
  modeId,
  Object.freeze({
    datastore: 'default',
    type: 'add_column',
    table: 'helm_history_entries',
    column: 'mode',
    sql: "ALTER TABLE helm_history_entries ADD COLUMN mode TEXT NOT NULL DEFAULT 'javascript'",
    risk: 'low'
  })
)
for (const datastore of datastores)
  if (
    fresh.databases[datastore].schemaHash !==
    current.databases[datastore].schemaHash
  )
    fail(
      'The captured current release differs from its reviewed fresh catalog.'
    )

function replay(schema, db, service, datastore) {
  const allowedNames = new Set(Object.keys(tables(legacy, datastore)))
  for (const [name, table] of Object.entries(schema)) {
    if (!allowedNames.has(name))
      fail('An upgrade database has an unregistered table.')
    const known = Object.values(profiles)
      .map((profile) => tables(profile, datastore)[name])
      .filter(Boolean)
    if (!known.some((candidate) => body(candidate) === body(table)))
      fail(
        'A native table definition differs from every reviewed adoption profile.'
      )
    // Only exact registered definitions are executed, never unchecked live SQL.
    const definition = known.find(
      (candidate) => body(candidate) === body(table)
    )
    db.exec(definition.sql)
  }
  for (const [name, table] of Object.entries(schema)) {
    const knownIndexes = Object.values(profiles).flatMap(
      (profile) => tables(profile, datastore)[name]?.indexes || []
    )
    for (const index of [...table.indexes].reverse()) {
      if (!index.sql) continue // Native UNIQUE indexes come from the table DDL.
      const registered = knownIndexes.find(
        (candidate) =>
          candidate.name === index.name && candidate.sql === index.sql
      )
      if (!registered)
        fail('An upgrade database has an unregistered or drifted native index.')
      db.exec(registered.sql)
    }
  }
  const reproduced = readSchema({
    path: service.path,
    transaction: { database: db }
  })
  if (
    reproduced.error ||
    ledger.digest(reproduced.tables) !== ledger.digest(schema)
  )
    fail('The native adoption catalog cannot be reproduced exactly.')
}
function completeCatalog(schema, db, datastore, mode) {
  const ids = []
  const target =
    mode === 'fresh' ? tables(fresh, datastore) : tables(legacy, datastore)
  if (mode === 'upgrade') {
    for (const name of Object.keys(tables(old, datastore)))
      if (!Object.hasOwn(schema, name))
        fail('A required legacy table is missing.')
  } else if (Object.keys(schema).length)
    fail('Fresh initialization requires empty databases.')
  function apply(id) {
    const statement = operations.get(id)
    db.exec(statement.sql)
    ids.push(id)
  }
  for (const [name, table] of Object.entries(target)) {
    if (!Object.hasOwn(schema, name)) {
      const profile = mode === 'fresh' ? 'fresh' : 'legacy'
      apply(`${profile}.${datastore}.${name}.table`)
      for (const index of [...table.indexes].reverse())
        if (index.sql) apply(`${profile}.${datastore}.${name}.${index.name}`)
      continue
    }
    if (
      datastore === 'default' &&
      name === 'helm_history_entries' &&
      !schema[name].columns.some((column) => column.name === 'mode')
    )
      apply(modeId)
    const existing = new Set(schema[name].indexes.map((index) => index.name))
    // Recreate only absent, registered named indexes. A same-named wrong index
    // was rejected during replay. Native UNIQUE constraints are never replaced.
    for (const index of [...table.indexes].reverse())
      if (index.sql && !existing.has(index.name))
        apply(`legacy.${datastore}.${name}.${index.name}`)
    // The real Bosun model mapper can omit normalized unique flags. A manual
    // table is not complete until the captured release's unique semantics are
    // covered. Clone preflight rejects duplicates before any live constraint.
    for (const desired of tables(fresh, datastore)[name]?.indexes || []) {
      if (!desired.unique || desired.partial || !desired.sql) continue
      const keys = (index) =>
        index.definition
          .filter((column) => column.key)
          .map(({ name, descending, collation }) => ({
            name,
            descending,
            collation
          }))
      const covered = schema[name].indexes.some(
        (index) =>
          index.unique &&
          !index.partial &&
          ledger.digest(keys(index)) === ledger.digest(keys(desired)) &&
          (!desired.columns.includes(null) || index.sql === desired.sql)
      )
      if (!covered && !existing.has(desired.name)) {
        apply(`fresh.${datastore}.${name}.${desired.name}`)
        existing.add(desired.name)
      }
    }
  }
  return ids
}
function createReleasePlan({
  services,
  image,
  instanceId,
  mode = 'upgrade',
  previous
}) {
  if (
    !['upgrade', 'fresh'].includes(mode) ||
    typeof instanceId !== 'string' ||
    !instanceId ||
    !Array.isArray(services) ||
    services.length !== datastores.length ||
    new Set(services.map((service) => service.datastore)).size !==
      datastores.length
  )
    fail(
      'Release planning requires an exact instance and all four owned datastores.'
    )
  if (previous) {
    if (mode !== 'upgrade')
      fail('Fresh initialization cannot inherit receipts.')
    previous = require('./upgrade-lineage')({
      previous,
      services,
      instanceId,
      image
    })
  }
  const steps = []
  for (const datastore of datastores) {
    const service = services.find((item) => item.datastore === datastore)
    if (
      !service ||
      typeof service.databaseKey !== 'string' ||
      !service.databaseKey
    )
      fail('Release planning has an invalid database target.')
    const schema = readSchema(service)
    if (schema.error) fail('An owned database is missing or unreadable.')
    if (schema.tables[ledger.table] && !previous)
      fail(
        'Use the recorded upgrade checkpoint to resume an already coordinated database.'
      )
    if (previous) delete schema.tables[ledger.table]
    if (mode === 'fresh') {
      const inspected = new Database(service.path, {
        readonly: true,
        fileMustExist: true
      })
      try {
        if (
          inspected
            .prepare(
              "SELECT COUNT(*) AS count FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'"
            )
            .get().count
        )
          fail(
            'Fresh initialization requires an empty native catalog, including views.'
          )
      } finally {
        inspected.close()
      }
    }
    const db = new Database(':memory:')
    try {
      if (mode === 'upgrade') replay(schema.tables, db, service, datastore)
      const operationIds = completeCatalog(schema.tables, db, datastore, mode)
      const after = readSchema({
        path: service.path,
        transaction: { database: db }
      })
      if (
        after.error ||
        db.pragma('integrity_check', { simple: true }) !== 'ok' ||
        db.pragma('foreign_key_check').length
      )
        fail('The native release catalog failed its integrity checks.')
      const statements = operationIds.map((id) => operations.get(id))
      steps.push({
        id: `release-88-${datastore}`,
        datastore,
        databaseKey: service.databaseKey,
        registryVersion: release,
        policy:
          mode === 'fresh'
            ? 'initialize'
            : ['analytics', 'cache'].includes(datastore)
            ? 'preserve-native-schema-and-data'
            : 'additive-native-upgrade',
        fromSchemaHash: ledger.digest(schema.tables),
        toSchemaHash: ledger.digest(after.tables),
        operationsHash: ledger.digest(statements.map(plans.contract)),
        operationIds
      })
    } finally {
      db.close()
    }
  }
  return ledger.createManifest({
    format: 1,
    version: release,
    image,
    instanceId,
    mode,
    ...(previous ? { previous } : {}),
    steps
  })
}
async function preparePlan({ step, service, source }) {
  if (
    step.registryVersion !== release ||
    source.version !== release ||
    !Array.isArray(step.operationIds)
  )
    fail('Upgrade step is not in this immutable release registry.')
  const statements = step.operationIds.map((id) => {
    const statement = operations.get(id)
    if (!statement || statement.datastore !== step.datastore)
      fail('Upgrade step references an unregistered operation.')
    return { ...statement }
  })
  if (ledger.digest(statements.map(plans.contract)) !== step.operationsHash)
    fail('Registered operation checksums do not match the reviewed step.')
  const schema = readSchema(service)
  if (schema.error) fail('Upgrade plan target is unreadable.')
  const models = {
    releaseCatalog: { registryVersion: release, stepHash: ledger.digest(step) }
  }
  const target = {
    kind: 'bosun',
    key: `release:${step.datastore}`,
    physicalKey: step.databaseKey
  }
  const selected = statements.map((statement, index) => ({
    ...statement,
    operationId: step.operationIds[index]
  }))
  const payload = {
    target,
    sourceHash: plans.digest(source),
    modelHash: plans.digest(models),
    schemaHash: plans.digest(schema.tables),
    statements
  }
  return {
    native: true,
    models,
    entry: {
      id: step.id,
      hash: plans.digest(payload),
      payload,
      selected,
      tables: new Set(statements.map((statement) => statement.table)),
      release: () => {}
    }
  }
}
module.exports = { createReleasePlan, preparePlan, release }
