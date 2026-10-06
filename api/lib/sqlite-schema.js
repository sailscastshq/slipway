const fs = require('node:fs')
const Database = require('better-sqlite3')

// Shared native catalog reader for Dock/Bosun and pre-ORM upgrade adoption.
// The caller retains ownership of an injected transaction connection.
module.exports = getSqliteSchema

function getSqliteSchema(service) {
  if (!service.path || !fs.existsSync(service.path)) {
    return { tables: {}, error: 'Database file not found' }
  }

  let db

  try {
    db =
      service.transaction?.database ||
      new Database(service.path, { readonly: true })
    const tableRows = db
      .prepare(
        `
      SELECT name, sql
      FROM sqlite_schema
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `
      )
      .all()
    const viewRows = db
      .prepare(
        `
      SELECT name, sql
      FROM sqlite_schema
      WHERE type = 'view'
      ORDER BY name
    `
      )
      .all()

    const tables = {}

    for (const { name, sql } of tableRows) {
      const tableName = escapeSqliteIdentifier(name)
      const columns = db.prepare(`PRAGMA table_xinfo('${tableName}')`).all()
      const indexes = db.prepare(`PRAGMA index_list('${tableName}')`).all()
      const foreignKeys = db
        .prepare(`PRAGMA foreign_key_list('${tableName}')`)
        .all()
      const triggers = db
        .prepare(
          `
          SELECT name, sql
          FROM sqlite_schema
          WHERE type = 'trigger' AND tbl_name = ?
          ORDER BY name
        `
        )
        .all(name)

      tables[name] = {
        name,
        sql,
        catalogComplete: !/^CREATE\s+VIRTUAL\s+TABLE/i.test(sql || ''),
        columns: columns.map((column) => ({
          position: column.cid,
          name: column.name,
          type: column.type,
          maxLength: null,
          nullable: column.notnull === 0,
          defaultValue: column.dflt_value,
          primaryKey: column.pk > 0,
          autoIncrement: column.pk > 0 && /\bAUTOINCREMENT\b/i.test(sql || ''),
          generated: column.hidden > 1,
          hidden: column.hidden
        })),
        indexes: indexes
          .filter((index) => index.origin !== 'pk')
          .map((index) => {
            const indexName = escapeSqliteIdentifier(index.name)
            const indexColumns = db
              .prepare(`PRAGMA index_xinfo('${indexName}')`)
              .all()
            const schemaEntry = db
              .prepare(
                `SELECT sql FROM sqlite_schema WHERE type = 'index' AND name = ?`
              )
              .get(index.name)

            return {
              name: index.name,
              columns: indexColumns
                .filter((column) => column.key === 1)
                .map((column) => column.name),
              unique: Boolean(index.unique),
              origin: index.origin,
              partial: Boolean(index.partial),
              sql: schemaEntry?.sql || null,
              definition: indexColumns.map((column) => ({
                position: column.seqno,
                columnId: column.cid,
                name: column.name,
                descending: Boolean(column.desc),
                collation: column.coll,
                key: Boolean(column.key)
              }))
            }
          }),
        foreignKeys: foreignKeys.map((foreignKey) => ({
          id: foreignKey.id,
          sequence: foreignKey.seq,
          table: foreignKey.table,
          from: foreignKey.from,
          to: foreignKey.to,
          onUpdate: foreignKey.on_update,
          onDelete: foreignKey.on_delete,
          match: foreignKey.match
        })),
        triggers,
        // SQLite validates the full schema during table replacement. Keep the
        // complete view inventory so rebuilds can replay transitive dependencies.
        views: viewRows
      }
    }

    return { tables }
  } catch (error) {
    return {
      tables: {},
      error: error.message,
      errorCode: /^SQLITE_[A-Z_]+$/.test(error.code || '')
        ? error.code
        : 'unconfirmed'
    }
  } finally {
    if (db && !service.transaction?.database) {
      db.close()
    }
  }
}

function escapeSqliteIdentifier(value) {
  return String(value).replace(/'/g, "''")
}
