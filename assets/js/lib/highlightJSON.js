// JSON syntax highlighter — colorizes JSON.stringify output
// Colors match SQL highlighter: keys pink, strings amber, numbers purple, booleans blue, null gray

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Tokenize pre-formatted JSON string
const jsonTokenPattern =
  /("(?:[^"\\]|\\.)*")\s*(:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(\btrue\b|\bfalse\b)|(\bnull\b)|(\s+)|(.)/g

export function highlightJSON(data) {
  const json = JSON.stringify(data, null, 2)
  if (!json) return ''

  const parts = []
  let match

  while ((match = jsonTokenPattern.exec(json)) !== null) {
    const [, str, colon, num, bool, nul, ws, other] = match
    if (str) {
      const escaped = escapeHtml(str)
      if (colon) {
        // Key (string followed by colon)
        parts.push(
          `<span class="text-pink-600 dark:text-pink-400">${escaped}</span>: `
        )
      } else {
        // String value
        parts.push(
          `<span class="text-amber-600 dark:text-amber-400">${escaped}</span>`
        )
      }
    } else if (num) {
      parts.push(
        `<span class="text-purple-600 dark:text-purple-400">${num}</span>`
      )
    } else if (bool) {
      parts.push(
        `<span class="text-blue-600 dark:text-blue-400">${bool}</span>`
      )
    } else if (nul) {
      parts.push(`<span class="text-gray-400 dark:text-gray-600">${nul}</span>`)
    } else if (ws) {
      parts.push(ws)
    } else if (other) {
      parts.push(escapeHtml(other))
    }
  }

  return parts.join('')
}
