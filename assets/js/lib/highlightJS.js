// Shared JavaScript syntax highlighter — used by project Helm and Bosun Helm
// Colors: keywords purple, builtins cyan, strings green, numbers orange, comments gray

const keywords = new Set([
  'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
  'debugger', 'default', 'delete', 'do', 'else', 'export', 'extends', 'finally',
  'for', 'function', 'if', 'import', 'in', 'instanceof', 'let', 'new', 'of',
  'return', 'static', 'super', 'switch', 'this', 'throw', 'try', 'typeof',
  'var', 'void', 'while', 'with', 'yield'
])

const builtins = new Set([
  'true', 'false', 'null', 'undefined', 'NaN', 'Infinity',
  'console', 'process', 'require', 'module', 'exports',
  'Array', 'Object', 'String', 'Number', 'Boolean', 'Date', 'Math', 'JSON',
  'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol', 'Error',
  'sails', 'User', 'Project', 'Environment', 'App', 'Deployment', 'Team', 'Setting'
])

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function highlightJS(code) {
  if (!code) return ''

  const tokens = []
  let i = 0

  while (i < code.length) {
    // Single-line comment
    if (code.slice(i, i + 2) === '//') {
      let end = code.indexOf('\n', i)
      if (end === -1) end = code.length
      tokens.push({ type: 'comment', value: code.slice(i, end) })
      i = end
      continue
    }

    // Multi-line comment
    if (code.slice(i, i + 2) === '/*') {
      let end = code.indexOf('*/', i + 2)
      if (end === -1) end = code.length
      else end += 2
      tokens.push({ type: 'comment', value: code.slice(i, end) })
      i = end
      continue
    }

    // String (single, double, template)
    if (code[i] === '"' || code[i] === "'" || code[i] === '`') {
      const quote = code[i]
      let end = i + 1
      while (end < code.length && code[end] !== quote) {
        if (code[end] === '\\') end++
        end++
      }
      if (end < code.length) end++
      tokens.push({ type: 'string', value: code.slice(i, end) })
      i = end
      continue
    }

    // Number
    if (/\d/.test(code[i]) || (code[i] === '.' && /\d/.test(code[i + 1]))) {
      let end = i
      while (end < code.length && /[\d.eExXa-fA-F_]/.test(code[end])) end++
      tokens.push({ type: 'number', value: code.slice(i, end) })
      i = end
      continue
    }

    // Word (keyword, builtin, or identifier)
    if (/[a-zA-Z_$]/.test(code[i])) {
      let end = i
      while (end < code.length && /[a-zA-Z0-9_$]/.test(code[end])) end++
      const word = code.slice(i, end)
      if (keywords.has(word)) {
        tokens.push({ type: 'keyword', value: word })
      } else if (builtins.has(word)) {
        tokens.push({ type: 'builtin', value: word })
      } else {
        tokens.push({ type: 'identifier', value: word })
      }
      i = end
      continue
    }

    // Operator/punctuation
    if (/[+\-*/%=<>!&|^~?:;,.()[\]{}]/.test(code[i])) {
      tokens.push({ type: 'punctuation', value: code[i] })
      i++
      continue
    }

    // Whitespace and newlines
    if (/\s/.test(code[i])) {
      let end = i
      while (end < code.length && /\s/.test(code[end])) end++
      tokens.push({ type: 'whitespace', value: code.slice(i, end) })
      i = end
      continue
    }

    // Fallback
    tokens.push({ type: 'other', value: code[i] })
    i++
  }

  return tokens.map(t => {
    const escaped = escapeHtml(t.value)
    switch (t.type) {
      case 'keyword':
        return `<span class="text-purple-600 dark:text-purple-400">${escaped}</span>`
      case 'builtin':
        return `<span class="text-cyan-600 dark:text-cyan-400">${escaped}</span>`
      case 'string':
        return `<span class="text-green-600 dark:text-green-400">${escaped}</span>`
      case 'number':
        return `<span class="text-orange-600 dark:text-orange-400">${escaped}</span>`
      case 'comment':
        return `<span class="text-gray-400 dark:text-gray-500">${escaped}</span>`
      case 'punctuation':
        return `<span class="text-gray-500 dark:text-gray-400">${escaped}</span>`
      default:
        return `<span class="text-gray-900 dark:text-gray-100">${escaped}</span>`
    }
  }).join('')
}
