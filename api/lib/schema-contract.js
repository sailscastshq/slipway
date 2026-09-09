// Fingerprints retain type modifiers and index semantics. Native definitions
// stay in the inventory so a planner can prove what it preserves.
function typeFingerprint(type, dialect) {
  let value = String(type || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s*\(\s*/g, '(')
    .replace(/\s*,\s*/g, ',')
    .replace(/\s*\)/g, ')')
  if (dialect === 'postgresql')
    value = value
      .replace(/^timestamp(\(\d+\))? with time zone$/, 'timestamptz$1')
      .replace(/^timestamp(\(\d+\))? without time zone$/, 'timestamp$1')
  const aliases =
    dialect === 'postgresql'
      ? {
          'character varying': 'varchar',
          character: 'char',
          int4: 'integer',
          int8: 'bigint',
          int2: 'smallint',
          float4: 'real',
          float8: 'double precision',
          decimal: 'numeric',
          serial: 'integer',
          bigserial: 'bigint',
          smallserial: 'smallint',
          bool: 'boolean',
          'timestamp with time zone': 'timestamptz',
          'timestamp without time zone': 'timestamp'
        }
      : dialect === 'mysql'
      ? {
          int: 'integer',
          bool: 'tinyint(1)',
          boolean: 'tinyint(1)',
          real: 'double',
          'double precision': 'double',
          numeric: 'decimal'
        }
      : { int: 'integer', bool: 'integer', boolean: 'integer', json: 'text' }
  const match = value.match(/^([^()]+)(.*)$/)
  if (match) value = (aliases[match[1]] || match[1]) + match[2]
  // MySQL integer display width does not change range; signedness does.
  if (dialect === 'mysql')
    value = value.replace(
      /^(tinyint|smallint|mediumint|integer|bigint)\(\d+\)/,
      '$1'
    )
  value = value.replace(/^(numeric|decimal)\((\d+)\)$/, '$1($2,0)')
  return value
}

function indexFingerprint(index) {
  return JSON.stringify({
    unique: Boolean(index.unique),
    columns: index.columns || [],
    partial: Boolean(index.partial),
    predicate: index.predicate || null,
    definition: index.definition || [],
    sql: index.sql || null
  })
}

function satisfiesIndex(index, column, unique) {
  if (unique && !index.unique) return false
  if (index.partial || index.predicate || index.simple === false) return false
  if (index.columns?.length !== 1 || typeof index.columns[0] !== 'string')
    return false
  if (index.columns[0] !== column) return false
  return !(index.definition || []).some(
    (key) =>
      key.key !== false &&
      (key.name === null ||
        key.prefixLength ||
        (key.collation &&
          !['BINARY', 'default', 'A', 'D'].includes(key.collation)))
  )
}

module.exports = { typeFingerprint, indexFingerprint, satisfiesIndex }
