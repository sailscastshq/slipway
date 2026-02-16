// Shared SQL syntax highlighter — merged keyword set from Dock + Bosun
// Colors: keywords pink, strings amber, numbers purple

const keywords = new Set([
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'LIKE', 'BETWEEN',
  'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'ON', 'AS', 'ORDER', 'BY', 'ASC', 'DESC',
  'LIMIT', 'OFFSET', 'GROUP', 'HAVING', 'UNION', 'ALL', 'DISTINCT',
  'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE',
  'CREATE', 'TABLE', 'ALTER', 'DROP', 'INDEX', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES',
  'CONSTRAINT', 'DEFAULT', 'AUTOINCREMENT', 'AUTO_INCREMENT', 'SERIAL',
  'IF', 'EXISTS', 'CASCADE', 'ADD', 'COLUMN',
  'INTEGER', 'TEXT', 'VARCHAR', 'BOOLEAN', 'REAL', 'BIGINT', 'TIMESTAMP', 'JSON', 'JSONB', 'UNIQUE',
  'PRAGMA', 'EXPLAIN',
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'CAST', 'TYPE'
])

const tokenPattern = /('(?:[^'\\]|\\.)*')|(\d+(?:\.\d+)?)|(\b[a-zA-Z_]\w*\b)|(\s+)|(.)/g

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function highlightSQL(sql) {
  if (!sql) return ''

  const tokens = []
  let match

  while ((match = tokenPattern.exec(sql)) !== null) {
    const [, str, num, word, ws, other] = match
    if (str) tokens.push({ type: 'string', value: str })
    else if (num) tokens.push({ type: 'number', value: num })
    else if (word) tokens.push({ type: keywords.has(word.toUpperCase()) ? 'keyword' : 'identifier', value: word })
    else if (ws) tokens.push({ type: 'whitespace', value: ws })
    else if (other) tokens.push({ type: 'other', value: other })
  }

  return tokens.map(t => {
    const escaped = escapeHtml(t.value)
    switch (t.type) {
      case 'keyword': return `<span class="text-pink-600 dark:text-pink-400">${escaped}</span>`
      case 'string': return `<span class="text-amber-600 dark:text-amber-400">${escaped}</span>`
      case 'number': return `<span class="text-purple-600 dark:text-purple-400">${escaped}</span>`
      default: return escaped
    }
  }).join('')
}
