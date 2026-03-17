// Shared log line syntax highlighter — used by Bosun instance logs and App container logs
// Escapes HTML first, then applies single-pass highlighting for timestamps, log levels,
// HTTP methods, status codes, paths, URLs, stack traces, port numbers, and brackets.

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function highlightLogLine(line) {
  let s = escapeHtml(line)

  // ISO timestamps
  s = s.replace(
    /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z?)/,
    '<span class="text-zinc-500">$1</span>'
  )

  // Log levels
  s = s.replace(
    /\b(error|Error|ERROR|ERR)\b/g,
    '<span class="text-rose-500 font-semibold">$1</span>'
  )
  s = s.replace(
    /\b(warn|Warn|WARN|warning|Warning|WARNING)\b/g,
    '<span class="text-amber-500 font-semibold">$1</span>'
  )
  s = s.replace(/\b(info|Info|INFO)\b/g, '<span class="text-sky-500">$1</span>')
  s = s.replace(
    /\b(debug|Debug|DEBUG|verbose|silly)\b/g,
    '<span class="text-zinc-500">$1</span>'
  )

  // HTTP methods
  s = s.replace(
    /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g,
    '<span class="text-cyan-500 font-medium">$1</span>'
  )

  // HTTP status codes (single-pass to avoid matching numbers in generated class names)
  s = s.replace(/\b([2-5]\d{2})\b/g, (match, code) => {
    const n = parseInt(code)
    if (n >= 200 && n < 300)
      return `<span class="text-emerald-500">${code}</span>`
    if (n >= 300 && n < 400) return `<span class="text-sky-500">${code}</span>`
    if (n >= 400 && n < 500)
      return `<span class="text-amber-500">${code}</span>`
    if (n >= 500 && n < 600) return `<span class="text-rose-500">${code}</span>`
    return match
  })

  // API paths and URLs
  s = s.replace(
    /(\/api\/[^\s"'<>]+)/g,
    '<span class="text-violet-500">$1</span>'
  )
  s = s.replace(
    /(https?:\/\/[^\s"'<>]+)/g,
    '<span class="text-sky-500 underline">$1</span>'
  )

  // Stack trace markers
  s = s.replace(/(\s+at\s+)/g, '<span class="text-zinc-600">$1</span>')

  // Port numbers
  s = s.replace(
    /(\bport\s*)(\d+)/gi,
    '$1<span class="text-emerald-500">$2</span>'
  )

  // Brackets/tags
  s = s.replace(/\[([^\]]+)\]/g, '<span class="text-zinc-600">[$1]</span>')

  return s
}
