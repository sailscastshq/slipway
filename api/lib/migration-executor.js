const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')
const planUtilities = require('./migration-plans')
const { quoteIdentifier } = require('./native-migration-contract')

// Dependency injection keeps the transaction engine usable before Sails/ORM lift.
// Callers still own authorization, immutable plan claims, metadata and audit policy.
module.exports = function createMigrationExecutor(adapters) {
  const {
    context,
    audit,
    getSchema,
    generateDiff,
    generateMigrationSql,
    applySqliteMigration,
    executeSql,
    openPostgresSession
  } = adapters
  for (const name of [
    'audit',
    'getSchema',
    'generateDiff',
    'generateMigrationSql',
    'applySqliteMigration',
    'executeSql',
    'openPostgresSession'
  ]) {
    if (typeof adapters[name] !== 'function')
      throw new TypeError(`Missing migration adapter: ${name}`)
  }
  if (
    typeof context?.refresh !== 'function' ||
    typeof context?.refreshVersion !== 'function'
  )
    throw new TypeError('Missing migration context adapters')
  if (
    adapters.beforeCommit !== undefined &&
    typeof adapters.beforeCommit !== 'function'
  )
    throw new TypeError('Invalid migration adapter: beforeCommit')
  const plans = { ...planUtilities, audit }
  return async function executeMigration({ entry, actor }) {
    let db,
      session,
      begun = false,
      committed = false,
      commitAttempted = false,
      service,
      backup
    const event = {
      planId: entry.id,
      reviewedHash: entry.hash,
      executedHash: plans.digest(entry.selected.map(plans.contract)),
      operationIds: entry.selected.map((item) => item.operationId)
    }
    try {
      const current = await context.refresh(entry.payload.target)
      service = current.service
      if (plans.digest(current.target) !== plans.digest(entry.payload.target))
        throw plans.failure(
          'The target database changed. Refresh the migration preview.'
        )
      if (!['sqlite', 'postgresql'].includes(service.type))
        throw plans.failure(
          'Automatic migration is unavailable until a whole-plan recovery workflow is verified for this engine.'
        )
      await plans.audit(actor, 'migration.started', event)
      const initial = await getSchema(service)
      if (initial.error)
        throw plans.failure('The current database schema could not be read.')
      if (service.type === 'sqlite') {
        db = new Database(service.path, { fileMustExist: true, timeout: 5000 })
        if (
          entry.selected.some(
            (item) => item.risk === 'high' || item.type === 'rebuild_table'
          )
        )
          backup = await verifiedBackup(db, service.path, entry.id)
        db.pragma('foreign_keys = OFF')
        db.exec('BEGIN IMMEDIATE')
        begun = true
        service = { ...service, transaction: { database: db } }
      } else {
        session = openPostgresSession(service)
        await run(
          session,
          "BEGIN; SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '30s'; SET LOCAL idle_in_transaction_session_timeout = '60s'"
        )
        begun = true
        const key = BigInt(
          '0x' + plans.digest(entry.payload.target.physicalKey).slice(0, 15)
        ).toString()
        const lock = await run(
          session,
          `SELECT pg_try_advisory_xact_lock(${key}) AS locked`
        )
        if (!['t', 'true', true].includes(lock.rows[0]?.locked))
          throw plans.failure(
            'Another migration is already running for this database.',
            'migrationBusy'
          )
        const tables = Object.keys(initial.tables).sort()
        if (tables.length)
          await run(
            session,
            `LOCK TABLE ${tables
              .map((table) => quoteIdentifier(table, 'postgresql'))
              .join(', ')} IN ACCESS EXCLUSIVE MODE`
          )
        service = { ...service, transaction: session }
      }
      const before = await getSchema(service)
      if (before.error)
        throw plans.failure('The locked database schema could not be verified.')
      const diff = await generateDiff(
        current.models,
        before.tables,
        service.type
      )
      const generated = await generateMigrationSql(
        diff,
        service.type,
        current.models,
        before.tables
      )
      if (generated.statements.some((item) => item.blocked))
        throw plans.failure(
          'The current migration is no longer verified. Refresh the preview.'
        )
      plans.validate(entry, {
        ...current,
        schema: before.tables,
        statements: generated.statements
      })
      const counts = await rowCounts(service, db, entry.tables, before.tables)
      if (db) {
        const result = await applySqliteMigration({
          databasePath: service.path,
          statements: entry.selected,
          connection: db
        })
        if (!result.success)
          throw plans.failure(
            result.results?.find((item) => item.error)?.error ||
              'The migration failed.'
          )
      } else
        for (const statement of entry.selected)
          await run(session, statement.sql)
      const after = await getSchema(service)
      if (after.error)
        throw plans.failure('The migrated schema could not be verified.')
      const selectedModels = Object.fromEntries(
        Object.entries(current.models).filter(([identity, model]) =>
          entry.tables.has(model.tableName || identity)
        )
      )
      const remaining = await generateDiff(
        selectedModels,
        after.tables,
        service.type
      )
      if (remaining.state !== 'up_to_date')
        throw plans.failure(
          'Postflight found remaining or unverified schema differences. The migration was rolled back.',
          'migrationPostflightMismatch'
        )
      const afterCounts = await rowCounts(
        service,
        db,
        entry.tables,
        before.tables
      )
      if (plans.digest(counts) !== plans.digest(afterCounts))
        throw plans.failure(
          'Row-count verification failed. The migration was rolled back.'
        )
      if (db) {
        if (
          db.pragma('integrity_check', { simple: true }) !== 'ok' ||
          db.pragma('foreign_key_check').length
        )
          throw plans.failure(
            'Database integrity verification failed. The migration was rolled back.'
          )
      } else await run(session, 'SET CONSTRAINTS ALL IMMEDIATE')
      if (
        plans.digest(await context.refreshVersion(entry.payload.target)) !==
        entry.payload.sourceHash
      )
        throw plans.failure(
          'The app or database version changed during migration. The migration was rolled back.'
        )
      const auditDb = db && service.datastore === 'default' ? db : null
      await plans.audit(
        actor,
        'migration.verified',
        {
          ...event,
          rowCounts: afterCounts,
          postflightHash: plans.digest(remaining),
          backup
        },
        auditDb
      )
      // Upgrade receipts must share the schema transaction on every datastore.
      // A post-commit audit cannot establish whether a retried step applied.
      if (adapters.beforeCommit)
        await adapters.beforeCommit({
          entry,
          service,
          database: db,
          session,
          before,
          after,
          rowCounts: afterCounts,
          backup
        })
      commitAttempted = true
      if (db) db.exec('COMMIT')
      else await run(session, 'COMMIT')
      committed = true
      await plans.audit(actor, 'migration.applied', {
        ...event,
        rowCounts: afterCounts,
        backup
      })
      return {
        success: true,
        executed: entry.selected.length,
        failed: 0,
        planId: entry.id,
        verified: true,
        appliedAt: new Date().toISOString()
      }
    } catch (error) {
      if (begun && !committed) {
        try {
          if (db) db.exec('ROLLBACK')
          else await session.query('ROLLBACK')
        } catch (_) {}
      }
      const outcome = committed
        ? 'committedAuditIncomplete'
        : commitAttempted
        ? 'unconfirmed'
        : 'rolledBack'
      try {
        await plans.audit(actor, 'migration.failed', {
          ...event,
          outcome,
          code: error.code || 'migrationFailed',
          backup
        })
      } catch (_) {}
      return {
        success: false,
        executed: committed ? entry.selected.length : 0,
        failed: 1,
        outcome,
        code: error.code || 'migrationFailed',
        error: committed
          ? 'The database changes committed, but the final audit event could not be recorded. Refresh and verify before continuing.'
          : commitAttempted
          ? 'The commit result could not be confirmed. Refresh the schema before making further changes.'
          : error.message
      }
    } finally {
      session?.close()
      db?.close()
      entry.release()
    }
  }

  async function run(session, query) {
    const result = await session.query(query)
    if (!result.success)
      throw plans.failure(result.error || 'A database operation failed.')
    return result
  }
  async function rowCounts(service, db, tables, existing) {
    const counts = {}
    for (const table of [...tables].sort()) {
      if (!existing[table]) continue
      const sql = `SELECT COUNT(*) AS count FROM ${quoteIdentifier(
        table,
        service.type
      )}`
      const count = db
        ? db.prepare(sql).get().count
        : (await executeSql(service, sql)).rows[0]?.count
      counts[table] = Number(count)
      if (!Number.isSafeInteger(counts[table]))
        throw plans.failure('The affected row count could not be verified.')
    }
    return counts
  }
  async function verifiedBackup(db, filename, id) {
    const directory = path.join(path.dirname(filename), 'migration-backups')
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
    const backupPath = path.join(directory, `${id}.sqlite`)
    let copy
    // Reserve a private file before the backup starts, including on failure.
    const descriptor = fs.openSync(backupPath, 'wx', 0o600)
    fs.closeSync(descriptor)
    try {
      await db.backup(backupPath)
      copy = new Database(backupPath, { readonly: true })
      if (copy.pragma('integrity_check', { simple: true }) !== 'ok')
        throw plans.failure(
          'The recovery backup did not pass its integrity check.'
        )
    } catch (error) {
      copy?.close()
      copy = null
      fs.rmSync(backupPath, { force: true })
      throw error
    } finally {
      copy?.close()
    }
    return {
      path: backupPath,
      verified: true,
      bytes: fs.statSync(backupPath).size
    }
  }
}
