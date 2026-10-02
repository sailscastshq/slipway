const { splitSqlStatements } = require('../../api/lib/dock-sql-results')

// A deterministic transport fixture, never a connection to an existing database.
function schemaCatalogFixture({
  type,
  tableCount = 40,
  columnsPerTable = 20,
  tableNames = Array.from({ length: tableCount }, (_, i) => `table_${i}`)
}) {
  const columns = tableNames.flatMap((name) =>
    Array.from({ length: columnsPerTable }, (_, i) => ({
      table_name: name,
      column_name: `column_${i}`,
      data_type: type === 'postgresql' ? 'text' : 'varchar(255)',
      character_maximum_length: type === 'postgresql' ? null : 255,
      is_nullable: 'YES',
      column_default: null,
      is_primary_key: false
    }))
  )
  const constraints = tableNames.map((name) => ({
    table_name: name,
    name: `${name}_check`,
    type: 'c',
    sql: 'CHECK (length(column_0) < 100)'
  }))
  const triggers = tableNames.map((name) => ({
    table_name: name,
    name: `${name}_trigger`,
    sql: 'fixture trigger definition'
  }))
  const views = [{ name: 'fixture_view', sql: 'SELECT * FROM table_0' }]
  const indexes = tableNames.map((name) => ({
    table_name: name,
    index_name: `${name}_index`,
    column_name: 'column_0',
    is_unique: false,
    non_unique: 1,
    position: 1,
    is_key: true,
    is_simple: true,
    index_type: 'BTREE',
    definition_sql: `CREATE INDEX ${name}_index ON ${name} (column_0)`
  }))
  const calls = []
  async function executeSql(service, query, latencyMs = 0) {
    if (latencyMs)
      await new Promise((resolve) => setTimeout(resolve, latencyMs))
    calls.push(query)
    const results = splitSqlStatements(query, service.type).map(
      (statement, statementIndex) => {
        const sql = statement.sql
        let rows
        if (/information_schema\.columns/i.test(sql)) rows = columns
        else if (/pg_index|information_schema\.STATISTICS/i.test(sql))
          rows = indexes
        else if (/pg_constraint/i.test(sql)) rows = constraints
        else if (/pg_trigger|information_schema\.TRIGGERS/i.test(sql))
          rows = triggers
        else if (/pg_get_viewdef|information_schema\.VIEWS/i.test(sql))
          rows = views
        else if (/^SHOW CREATE TABLE /i.test(sql)) {
          const name = sql.match(/^SHOW CREATE TABLE `((?:``|[^`])+)`;?$/i)?.[1]
          if (!name) throw new Error(`Unexpected fixture query: ${sql}`)
          rows = [
            { 'Create Table': `CREATE TABLE \`${name}\` (column_0 TEXT)` }
          ]
        } else throw new Error(`Unexpected fixture query: ${sql}`)
        return { statementIndex, status: 'success', rows }
      }
    )
    return { success: true, rows: results[0].rows, results }
  }
  return {
    executeSql,
    calls,
    tableNames,
    columns,
    constraints,
    triggers,
    views
  }
}

module.exports = { schemaCatalogFixture }
