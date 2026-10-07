const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const Database = require('better-sqlite3')
const createExecutor = require('./migration-executor')
const readSchema = require('./sqlite-schema')
const plans = require('./migration-plans')
const registry = require('./releases/0.0.88.json')
const compatibleSchema = require('./release-legacy-schema')
const applySqliteMigration =
  require('../helpers/dock/apply-sqlite-migration').fn

const receiptTable = '_slipway_release_migrations'
const receiptDdl = `CREATE TABLE ${receiptTable} (version TEXT PRIMARY KEY, checksum TEXT NOT NULL, backup TEXT, applied_at INTEGER NOT NULL)`
const checksum = plans.digest(registry)
const files = {
  default: 'app.db',
  observability: 'observability.db',
  analytics: 'analytics.db',
  cache: 'stash.db'
}

function fail(message) {
  const error = new Error(message)
  error.code = 'releaseMigrationBlocked'
  throw error
}

function schema(service) {
  const result = readSchema(service)
  if (result.error) fail('The Slipway database schema could not be read.')
  delete result.tables[receiptTable]
  return result.tables
}

function current(service) {
  const db = new Database(service.path, { readonly: true, fileMustExist: true })
  try {
    const receipt = db
      .prepare('SELECT type, sql FROM sqlite_schema WHERE name = ?')
      .get(receiptTable)
    if (!receipt) return false
    if (
      receipt.type !== 'table' ||
      receipt.sql !== receiptDdl ||
      db
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type = 'trigger' AND tbl_name = ?"
        )
        .all(receiptTable).length
    )
      fail('The reserved release receipt table is incompatible.')
    const recorded = db
      .prepare(`SELECT checksum FROM ${receiptTable} WHERE version = ?`)
      .get(registry.version)
    if (!recorded) return false
    if (recorded.checksum !== checksum)
      fail('The installed release migration checksum differs from this image.')
    const native = schema({ ...service, transaction: { database: db } })
    for (const [table, definition] of Object.entries(
      registry.datastores[service.datastore]
    )) {
      if (
        !native[table] ||
        !compatibleSchema(
          service.datastore,
          table,
          native[table].sql,
          definition
        ) ||
        (table === 'helm_history_entries' &&
          !native[table].columns.some((column) => column.name === 'mode'))
      )
        fail(
          `The recorded release schema changed at ${service.datastore}.${table}; review it before starting Slipway.`
        )
      for (const sql of definition.indexes) {
        const name =
          /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF NOT EXISTS\s+)?["`\[]?([^"`\]\s]+)/i.exec(
            sql
          )?.[1]
        const index = db
          .prepare('SELECT type, sql FROM sqlite_schema WHERE name = ?')
          .get(name)
        if (
          index?.type !== 'index' ||
          !compatibleSchema.index(index.sql, definition.indexes)
        )
          fail(
            `The recorded release index changed at ${name}; review it before starting Slipway.`
          )
      }
    }
    return true
  } finally {
    db.close()
  }
}

// Produce an immutable additive plan on a real SQLite clone. Unrelated tables,
// views and triggers stay in the clone and in the postflight fingerprint.
function prepare(service) {
  const before = schema(service)
  const db = new Database(service.path, { fileMustExist: true, timeout: 5000 })
  const statements = []
  let recorded = false
  const add = (type, table, sql, column = null) => {
    statements.push({ type, table, sql, column, risk: 'low' })
    db.exec(sql)
  }
  try {
    const receipt = db
      .prepare('SELECT type, sql FROM sqlite_schema WHERE name = ?')
      .get(receiptTable)
    if (receipt) {
      if (
        receipt.type !== 'table' ||
        receipt.sql !== receiptDdl ||
        db
          .prepare(
            "SELECT name FROM sqlite_schema WHERE type = 'trigger' AND tbl_name = ?"
          )
          .all(receiptTable).length
      )
        fail('The reserved release receipt table is incompatible.')
      const existingReceipt = db
        .prepare(`SELECT checksum FROM ${receiptTable} WHERE version = ?`)
        .get(registry.version)
      if (existingReceipt && existingReceipt.checksum !== checksum)
        fail(
          'The installed release migration checksum differs from this image.'
        )
      recorded = Boolean(existingReceipt)
    }
    db.exec('BEGIN IMMEDIATE')
    for (const [table, definition] of Object.entries(
      registry.datastores[service.datastore]
    )) {
      const existing = before[table]
      if (!existing) add('create_table', table, definition.create)
      else {
        if (
          !compatibleSchema(service.datastore, table, existing.sql, definition)
        )
          fail(
            `Review the incompatible ${service.datastore}.${table} schema before updating; no destructive migration was attempted.`
          )
        if (
          table === 'helm_history_entries' &&
          !existing.columns.some((column) => column.name === 'mode')
        )
          add(
            'add_column',
            table,
            "ALTER TABLE helm_history_entries ADD COLUMN mode TEXT NOT NULL DEFAULT 'javascript'",
            'mode'
          )
      }
      for (const sql of definition.indexes) {
        const name =
          /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF NOT EXISTS\s+)?["`\[]?([^"`\]\s]+)/i.exec(
            sql
          )?.[1]
        if (!name) fail('The release registry contains an invalid index.')
        const index = db
          .prepare('SELECT type, sql FROM sqlite_schema WHERE name = ?')
          .get(name)
        if (index) {
          if (
            index.type !== 'index' ||
            !compatibleSchema.index(index.sql, definition.indexes)
          )
            fail(`Review the incompatible ${name} index before updating.`)
        } else add('create_index', table, sql)
      }
    }
    const after = schema({ ...service, transaction: { database: db } })
    if (
      db.pragma('integrity_check', { simple: true }) !== 'ok' ||
      db.pragma('foreign_key_check').length
    )
      fail('The release migration did not pass SQLite integrity checks.')
    return { before, after, statements, recorded }
  } finally {
    if (db.inTransaction) db.exec('ROLLBACK')
    db.close()
  }
}

async function execute(service, prepared, beforeCommit, assertBudget) {
  const source = { release: registry.version, checksum }
  const models = { release: source }
  const target = {
    kind: 'bosun',
    key: `release:${service.datastore}`,
    physicalKey: fs.realpathSync(service.path)
  }
  const { before, after, statements } = prepared
  const selected = statements.map((statement, index) => ({
    ...statement,
    operationId: `${registry.version}:${service.datastore}:${index}`
  }))
  const entry = {
    id: `${registry.version}-${service.datastore}-${crypto.randomUUID()}`,
    hash: plans.digest(statements),
    payload: {
      target,
      modelHash: plans.digest(models),
      sourceHash: plans.digest(source),
      schemaHash: plans.digest(before),
      statements
    },
    selected,
    tables: new Set(statements.map((statement) => statement.table)),
    release() {}
  }
  const executor = createExecutor({
    context: {
      refresh: async () => ({ service, target, source, models }),
      refreshVersion: async () => source
    },
    audit: async () => {},
    getSchema: async (targetService) => ({ tables: schema(targetService) }),
    generateDiff: async (_, current) => ({
      state:
        plans.digest(current) === plans.digest(after)
          ? 'up_to_date'
          : plans.digest(current) === plans.digest(before)
          ? 'changes_pending'
          : 'unverified'
    }),
    generateMigrationSql: async (diff) => ({
      statements: diff.state === 'unverified' ? [{ blocked: true }] : statements
    }),
    applySqliteMigration,
    executeSql: async () =>
      fail('Release migrations require the owned SQLite transaction.'),
    openPostgresSession: () =>
      fail('Release migrations only operate on Slipway SQLite databases.'),
    requireBackup: true,
    assertBudget,
    beforeCommit: async (input) => {
      await beforeCommit?.(input)
      input.database.exec(
        `CREATE TABLE IF NOT EXISTS ${receiptTable} (version TEXT PRIMARY KEY, checksum TEXT NOT NULL, backup TEXT, applied_at INTEGER NOT NULL)`
      )
      input.database
        .prepare(
          `INSERT INTO ${receiptTable} (version, checksum, backup, applied_at) VALUES (?, ?, ?, ?) ON CONFLICT(version) DO UPDATE SET backup = excluded.backup, applied_at = excluded.applied_at`
        )
        .run(
          registry.version,
          checksum,
          JSON.stringify(input.backup),
          Date.now()
        )
    }
  })
  const result = await executor({ entry, actor: { id: 0, team: 0 } })
  if (!result.success)
    fail(
      `Release migration failed (${result.outcome}); the verified backup is retained. ${result.error}`
    )
  return result
}

// Preflight never executes SQL against live storage. All datastores pass clone
// execution before the first live transaction. Each live step has its own
// verified backup and transaction receipt, so a restart resumes safely.
async function run({
  directory,
  preflightOnly = false,
  beforeCommit,
  maxDurationMs = 45000,
  availableBytes
} = {}) {
  const started = performance.now()
  const assertBudget = () => {
    if (performance.now() - started >= maxDurationMs)
      fail(
        'Release migration exceeded its startup deadline; verified checkpoints and backups are retained. Review storage performance before retrying.'
      )
  }
  const freeBytes =
    availableBytes ||
    ((target) => {
      const stat = fs.statfsSync(target)
      return Number(stat.bavail) * Number(stat.bsize)
    })
  let capacityChecked = false
  let preflightMs = 0
  const workspace = fs.mkdtempSync(
    path.join(require('node:os').tmpdir(), 'slipway-release-')
  )
  let peakAdditionalBytes = 0
  const bytesIn = (directory) =>
    fs.existsSync(directory)
      ? fs
          .readdirSync(directory, { withFileTypes: true })
          .reduce((total, item) => {
            const filename = path.join(directory, item.name)
            return (
              total +
              (item.isDirectory()
                ? bytesIn(filename)
                : item.isFile()
                ? fs.statSync(filename).size
                : 0)
            )
          }, 0)
      : 0
  const previousBackupBytes = bytesIn(path.join(directory, 'migration-backups'))
  const measurePeak = () => {
    peakAdditionalBytes = Math.max(
      peakAdditionalBytes,
      bytesIn(workspace) +
        bytesIn(path.join(directory, 'migration-backups')) -
        previousBackupBytes
    )
  }
  const prepared = []
  try {
    const existing = Object.values(files)
      .map((filename) => path.join(directory, filename))
      .filter((filename) => fs.existsSync(filename))
    if (
      existing.length !== Object.keys(files).length &&
      existing.some((filename) => fs.statSync(filename).size > 0)
    )
      fail(
        'An existing Slipway datastore is missing; restore or review its storage mapping before updating.'
      )
    const inodes = new Set()
    for (const [datastore, filename] of Object.entries(files)) {
      const livePath = path.join(directory, filename)
      const exists = fs.existsSync(livePath)
      if (exists) {
        const stat = fs.lstatSync(livePath)
        const inode = `${stat.dev}:${stat.ino}`
        if (!stat.isFile() || stat.nlink !== 1 || inodes.has(inode))
          fail(
            'Slipway datastores must be distinct regular files; review the ambiguous storage mapping before updating.'
          )
        inodes.add(inode)
        const service = { type: 'sqlite', path: livePath, datastore }
        try {
          if (current(service)) continue
        } catch (error) {
          if (error.code !== 'SQLITE_READONLY_ROLLBACK' || preflightOnly)
            throw error
          assertBudget()
          // A killed transaction may have a hot rollback journal. SQLite must
          // recover its last committed state before readonly receipt/preflight
          // queries can run. Only normal startup performs this native recovery;
          // it does not run migration SQL or restore a snapshot over the file.
          const recovery = new Database(livePath, {
            fileMustExist: true,
            timeout: 5000
          })
          try {
            recovery.prepare('SELECT name FROM sqlite_schema LIMIT 1').get()
          } finally {
            recovery.close()
          }
          assertBudget()
          if (current(service)) continue
        }
      }
      if (!exists && preflightOnly)
        fail(
          'An existing Slipway datastore is missing; update validation cannot initialize live storage.'
        )
      assertBudget()
      fs.mkdirSync(directory, { recursive: true })
      if (!capacityChecked) {
        // Clones, their verification backups and live recovery snapshots can
        // coexist. Keep conservative headroom on each involved filesystem.
        const sourceBytes = existing.reduce(
          (total, filename) => total + fs.statSync(filename).size,
          0
        )
        const requiredBytes = sourceBytes * 3 + 32 * 1024 * 1024
        if (
          [directory, workspace].some(
            (target) => freeBytes(target) < requiredBytes
          )
        )
          fail(
            'Insufficient disk space for release validation and retained recovery backups; no live migration started.'
          )
        capacityChecked = true
      }
      const source = new Database(exists ? livePath : ':memory:', {
        readonly: exists,
        fileMustExist: exists
      })
      const clonePath = path.join(workspace, filename)
      try {
        await source.backup(clonePath, {
          progress() {
            assertBudget()
            return 200
          }
        })
        assertBudget()
      } finally {
        source.close()
      }
      const clone = { type: 'sqlite', path: clonePath, datastore }
      const plan = prepare(clone)
      // Even a no-op plan verifies the complete catalog and native integrity.
      if (plan.statements.length || !plan.recorded)
        await execute(clone, plan, undefined, assertBudget)
      prepared.push({ datastore, livePath, exists, plan })
      measurePeak()
    }
    preflightMs = performance.now() - started
    if (preflightOnly)
      return {
        timings: { preflightMs, peakAdditionalBytes },
        mode: 'preflight',
        normalStartupReady: false,
        version: registry.version
      }
    const results = []
    // Reserve every fresh datastore before the first transaction. A killed
    // initial reservation can safely resume while the only existing files are
    // still empty; a missing database beside populated storage never becomes
    // a silently reset installation.
    for (const item of prepared)
      if (!item.exists) {
        const descriptor = fs.openSync(item.livePath, 'wx', 0o600)
        fs.closeSync(descriptor)
      }
    for (const item of prepared) {
      if (!item.plan.statements.length && item.plan.recorded) continue
      const service = {
        type: 'sqlite',
        path: item.livePath,
        datastore: item.datastore
      }
      assertBudget()
      results.push(
        await execute(service, item.plan, beforeCommit, assertBudget)
      )
      measurePeak()
    }
    return {
      timings: {
        preflightMs,
        peakAdditionalBytes,
        applyMs: performance.now() - started - preflightMs,
        totalMs: performance.now() - started
      },
      mode: 'applied',
      version: registry.version,
      migratedDatastores: results.length
    }
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true })
  }
}

module.exports = {
  run,
  current,
  prepare,
  execute,
  files,
  receiptTable,
  receiptDdl,
  checksum
}
