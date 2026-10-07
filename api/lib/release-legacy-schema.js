const historical = require('./releases/legacy-helper-ddl.json').entries
const production = require('./releases/legacy-production-layouts.json')
const matchesLayout = require('./release-schema-layout')

// Definitions from pre-release helpers and the reported production apps schema.
// These are compatibility alternatives, never instructions to rewrite a table.
const legacyColumns = {
  apps: {
    // Observed production schema; matches App.healthPath.defaultsTo.
    health_path: "TEXT DEFAULT '/health'",
    bridge_enabled: 'BOOLEAN NOT NULL DEFAULT 0',
    bridge_secret: 'TEXT',
    bearing_enabled: 'BOOLEAN NOT NULL DEFAULT 0',
    bearing_secret: 'TEXT',
    wake_enabled: 'BOOLEAN NOT NULL DEFAULT 0',
    wake_secret: 'TEXT',
    wake_settings: "TEXT NOT NULL DEFAULT '{}'",
    secure_env_vars: 'TEXT',
    env_var_metadata: "TEXT NOT NULL DEFAULT '{}'"
  },
  environments: { env_var_metadata: "TEXT NOT NULL DEFAULT '{}'" },
  deployments: {
    config_hash: 'TEXT',
    config_manifest: "TEXT NOT NULL DEFAULT '[]'",
    source_revision: 'TEXT'
  },
  backups: {
    object_key: 'TEXT',
    storage: "TEXT NOT NULL DEFAULT '{}'",
    storage_credentials: 'TEXT'
  },
  users: { auth_version: "TEXT NOT NULL DEFAULT ''" },
  cli_tokens: { auth_version: "TEXT NOT NULL DEFAULT ''", team_id: 'INTEGER' },
  wake_events: {
    host_user_id: 'TEXT',
    dimensions: "TEXT NOT NULL DEFAULT '{}'",
    provenance: "TEXT NOT NULL DEFAULT 'runtime'",
    aggregated: 'INTEGER NOT NULL DEFAULT 0',
    properties: "TEXT NOT NULL DEFAULT '{}'"
  },
  services: {
    custom_recovery: 'TEXT',
    public_route: "TEXT NOT NULL DEFAULT '{}'",
    custom_definition: 'TEXT',
    custom_state: "TEXT NOT NULL DEFAULT '{}'",
    management_mode: "TEXT NOT NULL DEFAULT 'managed'",
    external_connection: 'TEXT',
    external_verification: "TEXT NOT NULL DEFAULT '{}'",
    image_reference: 'TEXT',
    image_metadata: 'TEXT',
    upgrade_state: 'TEXT'
  }
}

// Compare complete declarations, retaining literals and all constraints. Only
// identifier quoting, keyword case, whitespace and column order may differ.
// Unknown syntax fails closed; PRAGMA alone would miss CHECK/COLLATE constraints.
function tokenize(sql) {
  if (typeof sql !== 'string' || sql.length > 32768) return null
  const tokens = []
  const pattern =
    /\s+|'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]+\]|[a-zA-Z_][a-zA-Z_0-9]*|[0-9]+|[(),.+-]/gy
  let offset = 0
  while (offset < sql.length) {
    pattern.lastIndex = offset
    const match = pattern.exec(sql)
    if (!match) return null
    offset = pattern.lastIndex
    const token = match[0]
    if (/^\s/.test(token)) continue
    tokens.push(
      token[0] === "'"
        ? token
        : token.replace(/^["`\[]|["`\]]$/g, '').toLowerCase()
    )
  }
  return tokens
}

function declarations(sql, table) {
  const tokens = tokenize(sql)
  if (!tokens) return null
  if (
    tokens.slice(0, 4).join(' ') !== `create table ${table} (` ||
    tokens.at(-1) !== ')'
  )
    return null
  const parts = []
  let part = [],
    depth = 0
  for (const token of tokens.slice(4, -1)) {
    if (token === '(') depth++
    if (token === ')') depth--
    if (depth < 0) return null
    if (token === ',' && depth === 0) {
      parts.push(part)
      part = []
    } else part.push(token)
  }
  if (depth !== 0 || !part.length) return null
  parts.push(part)
  if (
    parts.some((part) => !part.length) ||
    new Set(parts.map((part) => part[0])).size !== parts.length
  )
    return null
  return parts.map((part) => part.join(' ')).sort()
}

function columnNames(parts) {
  return parts
    .map((part) => part.split(' ')[0])
    .filter(
      (name) =>
        !['unique', 'primary', 'foreign', 'check', 'constraint'].includes(name)
    )
    .sort()
}

function historicalDefinition(entry, table, definition) {
  const parts = declarations(entry.sql, table)
  const desired = declarations(definition.create, table)
  if (!parts || !desired) return null
  const present = new Set(columnNames(parts))
  for (const name of columnNames(desired)) {
    if (present.has(name)) continue
    const alternative = legacyColumns[table]?.[name]
    if (!alternative) return null
    parts.push(`${name} ${alternative}`)
  }
  return `CREATE TABLE ${table} (${parts.join(', ')})`
}

function compatible(datastore, table, sql, definition) {
  // Whole reviewed production layouts may retain known historical columns.
  // Only those exact declarations are admitted; arbitrary extras still reject.
  if (matchesLayout(sql, production.datastores[datastore]?.[table] || []))
    return true
  if (definition.accepted.includes(sql)) return true
  const actual = declarations(sql, table)
  if (!actual) return false
  // Historical helper templates must account for every released column.
  if (
    !definition.accepted.some(
      (sql) =>
        JSON.stringify(columnNames(declarations(sql, table) || [])) ===
        JSON.stringify(columnNames(actual))
    )
  )
    return false
  const expectedDefinitions = [
    ...definition.accepted,
    ...historical
      .filter(
        (entry) =>
          /^CREATE TABLE /i.test(entry.sql) &&
          tokenize(entry.sql)?.[2] === table
      )
      .map((entry) => historicalDefinition(entry, table, definition))
      .filter(Boolean)
  ]
  return expectedDefinitions.some((expectedSql) => {
    const expected = declarations(expectedSql, table)
    if (!expected || expected.length !== actual.length) return false
    return actual.every((part, index) => {
      if (part === expected[index]) return true
      const name = part.split(' ')[0]
      if (
        expected[index].split(' ')[0] !== name ||
        !(
          (datastore === 'default' && legacyColumns[table]?.[name]) ||
          (datastore === 'analytics' &&
            table === 'wake_events' &&
            legacyColumns.wake_events?.[name])
        )
      )
        return false
      const legacy = declarations(
        `CREATE TABLE ${table} (${name} ${legacyColumns[table]?.[name]})`,
        table
      )
      return legacy?.[0] === part
    })
  })
}

function compatibleIndex(sql, expectedDefinitions) {
  if (expectedDefinitions.includes(sql)) return true
  const actual = tokenize(sql)
  if (!actual) return false
  const name = actual[1] === 'unique' ? actual[3] : actual[2]
  const alternatives = historical
    .filter((entry) => {
      const tokens = tokenize(entry.sql)
      return (
        tokens &&
        tokens[0] === 'create' &&
        (tokens[1] === 'index' || tokens[1] === 'unique') &&
        (tokens[1] === 'unique' ? tokens[3] : tokens[2]) === name
      )
    })
    .map((entry) => entry.sql)
  return [...expectedDefinitions, ...alternatives].some(
    (expected) => tokenize(expected)?.join(' ') === actual.join(' ')
  )
}

module.exports = compatible
module.exports.index = compatibleIndex
