const UNSUPPORTED_MARKDOWN = [
  {
    code: 'html-comments',
    label: 'HTML comments',
    pattern: /<!--[\s\S]*?-->/
  },
  {
    code: 'raw-html',
    label: 'embedded HTML',
    pattern:
      /<\/?[a-z][a-z\d-]*(?:\s[^<>]*?)?\s*\/?>|<![A-Z][^>]*>|<\?[\s\S]*?\?>/i
  },
  {
    code: 'footnotes',
    label: 'footnotes',
    pattern: /(^|\n)\s*\[\^[^\]]+\]:|(?<!\\)\[\^[^\]]+\]/
  },
  {
    code: 'reference-links',
    label: 'reference-style links',
    pattern: /(^|\n)\s{0,3}\[[^\]]+\]:\s*\S+/
  },
  {
    code: 'tables',
    label: 'tables',
    pattern:
      /(^|\n)\s*\|?.+\|.+\n\s*\|?\s*:?-{3,}:?\s*\|(?:\s*:?-{3,}:?\s*\|?)+/
  },
  {
    code: 'task-lists',
    label: 'task lists',
    pattern: /(^|\n)\s*[-+*]\s+\[[ xX]\]\s+/
  },
  {
    code: 'directives',
    label: 'custom directives',
    pattern: /(^|\n)\s*(?:::[:\w-]*|\{\{)/
  },
  {
    code: 'mdx',
    label: 'MDX or component syntax',
    pattern:
      /(^|\n)\s*(?:import|export)\s.+(?:from\s+)?['"]|<\/?[A-Z][A-Za-z0-9.]*(?:\s|>|\/>)/
  }
]

const BLOCKED_PROTOCOL = /^[a-z][a-z\d+.-]*:/i
const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:'])
const SAFE_IMAGE_PROTOCOLS = new Set(['http:', 'https:'])
const MARKDOWN_AUTOLINK =
  /<[a-z][a-z\d+.-]{1,31}:[^<>\s]*>|<[a-z\d.!#$%&'*+/=?^_`{|}~-]+@[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?)+>/gi
const RAW_HTML =
  /<!--[\s\S]*?-->|<\/?[a-z][^<>]*>|<![A-Z][^>]*>|<\?[\s\S]*?\?>/i

export function inspectMarkdown(markdown = '') {
  const issues = UNSUPPORTED_MARKDOWN.filter(({ pattern }) =>
    pattern.test(markdown)
  ).map(({ code, label }) => ({ code, label }))

  return {
    supported: issues.length === 0,
    issues
  }
}

export function containsRawHtml(markdown = '') {
  return RAW_HTML.test(String(markdown).replace(MARKDOWN_AUTOLINK, ''))
}

export function normalizeMarkdownBoundary(markdown = '') {
  return String(markdown)
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '')
}

export function roundTripMatches(source, serialized) {
  return (
    normalizeMarkdownBoundary(source) === normalizeMarkdownBoundary(serialized)
  )
}

export function preserveMarkdownEnvelope(serialized, source = '') {
  const lineEnding = String(source).includes('\r\n') ? '\r\n' : '\n'
  let output = String(serialized).replace(/\r\n?/g, '\n')

  if (/^\r?\n/.test(source) && output) output = `\n${output}`
  if (/\r?\n$/.test(source) && output && !output.endsWith('\n')) output += '\n'

  return lineEnding === '\n' ? output : output.replace(/\n/g, lineEnding)
}

export function normalizeLinkUrl(value) {
  const url = String(value || '').trim()
  if (!url || hasUnsafeCharacters(url)) return null

  if (isRelativeUrl(url)) return url

  if (!BLOCKED_PROTOCOL.test(url)) {
    if (/^[^\s/]+\.[^\s]+$/.test(url)) return `https://${url}`
    return url
  }

  try {
    const parsed = new URL(url)
    return SAFE_LINK_PROTOCOLS.has(parsed.protocol) ? url : null
  } catch {
    return null
  }
}

export function normalizeImageUrl(value) {
  const url = String(value || '').trim()
  if (!url || hasUnsafeCharacters(url)) return null
  if (url.startsWith('/')) return url

  try {
    const parsed = new URL(url)
    return SAFE_IMAGE_PROTOCOLS.has(parsed.protocol) ? url : null
  } catch {
    return null
  }
}

export function looksLikeImageUrl(value) {
  const url = normalizeImageUrl(value)
  if (!url) return false

  try {
    const pathname = new URL(url, 'https://slipway.local').pathname
    return /\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(pathname)
  } catch {
    return false
  }
}

function isRelativeUrl(url) {
  return (
    url.startsWith('/') ||
    url.startsWith('./') ||
    url.startsWith('../') ||
    url.startsWith('#')
  )
}

function hasUnsafeCharacters(url) {
  return /[\u0000-\u001F\u007F\s]/.test(url)
}
