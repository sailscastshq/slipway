// Match registered SQLite layouts without depending on column order, quoting
// or whitespace. Preserve every declaration token: types, defaults, CHECKs,
// collations, keys, foreign keys and table options must still match a reviewed
// layout. This is admission only; existing tables are never rewritten.
function tokens(sql) {
  const result = []
  let cursor = 0
  const pattern =
    /\s+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|[A-Za-z_][A-Za-z_0-9$]*|[0-9]+(?:\.[0-9]+)?|./gy
  while (cursor < sql.length) {
    pattern.lastIndex = cursor
    const match = pattern.exec(sql)
    if (!match) return null
    cursor = pattern.lastIndex
    const value = match[0]
    if (/^\s|^--|^\/\*/.test(value)) continue
    if (value[0] === "'") result.push(value)
    else if (value[0] === '"' || value[0] === '`')
      result.push(
        value
          .slice(1, -1)
          .replaceAll(value[0] + value[0], value[0])
          .toLowerCase()
      )
    else if (value[0] === '[') result.push(value.slice(1, -1).toLowerCase())
    else result.push(value.toLowerCase())
  }
  return result
}

function layout(sql) {
  if (typeof sql !== 'string') return null
  const parts = tokens(sql)
  if (!parts || parts[0] !== 'create' || parts[1] !== 'table') return null
  if (parts.slice(2, 5).join(' ') === 'if not exists') parts.splice(2, 3)
  if (parts[3] !== '(') return null
  const segments = []
  let start = 4
  let depth = 1
  let end
  for (let i = start; i < parts.length; i++) {
    if (parts[i] === '(') depth++
    if (parts[i] === ')') depth--
    if (depth === 0 || (depth === 1 && parts[i] === ',')) {
      segments.push(parts.slice(start, i))
      start = i + 1
    }
    if (depth === 0) {
      end = i
      break
    }
  }
  if (end === undefined || segments.some((segment) => !segment.length))
    return null
  // Sorting complete declarations changes neither a key's column sequence nor
  // any expression. Duplicate names/declarations cannot match registered SQL.
  return JSON.stringify({
    table: parts[2],
    declarations: segments.map((segment) => JSON.stringify(segment)).sort(),
    options: parts.slice(end + 1).filter((part) => part !== ';')
  })
}

module.exports = function matchesLayout(sql, accepted) {
  if (accepted.includes(sql)) return true
  const actual = layout(sql)
  return (
    actual !== null &&
    accepted.some((candidate) => layout(candidate) === actual)
  )
}

module.exports.index = function matchesIndex(sql, accepted) {
  if (accepted.includes(sql)) return true
  function normalize(value) {
    if (typeof value !== 'string') return null
    const parts = tokens(value)
    const index = parts?.[1] === 'unique' ? 2 : 1
    if (parts?.[0] !== 'create' || parts[index] !== 'index') return null
    if (parts.slice(index + 1, index + 4).join(' ') === 'if not exists')
      parts.splice(index + 1, 3)
    if (parts.at(-1) === ';') parts.pop()
    return JSON.stringify(parts)
  }
  const actual = normalize(sql)
  return (
    actual !== null &&
    accepted.some((candidate) => normalize(candidate) === actual)
  )
}
