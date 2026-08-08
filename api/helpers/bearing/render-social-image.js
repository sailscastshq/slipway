const { Resvg } = require('@resvg/resvg-js')

module.exports = {
  friendlyName: 'Render Bearing social image',

  description: 'Render a programmatic Open Graph image for a Bearing surface.',

  inputs: {
    appName: { type: 'string', required: true },
    surface: {
      type: 'string',
      isIn: ['feedback', 'roadmap', 'updates'],
      required: true
    },
    item: { type: 'ref' },
    itemCount: { type: 'number', defaultsTo: 0, min: 0 },
    categoryLabel: { type: 'string' }
  },

  exits: { success: { outputType: 'ref' } },

  fn: async function ({ appName, surface, item, itemCount, categoryLabel }) {
    const surfaceName = titleCase(surface)
    const headline = {
      feedback: 'Help shape what comes next',
      roadmap: 'See what we are building next',
      updates: 'What is new and improved'
    }[surface]
    const titleLines = wrap(item?.title || emptyTitle(surface), 44, 2)
    const meta = item
      ? [categoryLabel, statusLabel(item.status), votes(item.voteCount)]
          .filter(Boolean)
          .join('  ·  ')
      : `${itemCount} ${itemCount === 1 ? 'post' : 'posts'}`
    const svg = `
      <svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
        <rect width="1200" height="630" fill="#f4f4f1"/>
        <rect x="44" y="40" width="1112" height="550" rx="34" fill="#ffffff"/>
        <rect x="88" y="84" width="42" height="42" rx="12" fill="#111111"/>
        <path d="M102 96h10.5c7 0 11.5 3.7 11.5 9.2 0 5.8-4.5 9.8-11.8 9.8H108v7h-6V96Zm6 5v9h4.2c3.7 0 5.8-1.7 5.8-4.6 0-2.8-2.1-4.4-5.8-4.4H108Z" fill="#fff"/>
        <text x="150" y="111" fill="#161616" font-family="Arial, sans-serif" font-size="23" font-weight="700">${escapeXml(
          appName
        )}</text>
        <text x="1082" y="111" text-anchor="end" fill="#777773" font-family="Arial, sans-serif" font-size="20">${surfaceName}</text>
        <text x="88" y="203" fill="#969691" font-family="Arial, sans-serif" font-size="16" font-weight="700" letter-spacing="3">BEARING</text>
        <text x="88" y="263" fill="#111111" font-family="Arial, sans-serif" font-size="46" font-weight="700">${escapeXml(
          headline
        )}</text>
        <rect x="88" y="310" width="1024" height="176" rx="24" fill="#f7f7f5"/>
        <circle cx="128" cy="350" r="9" fill="#171717"/>
        <text x="153" y="356" fill="#73736f" font-family="Arial, sans-serif" font-size="18">${escapeXml(
          meta
        )}</text>
        ${titleLines
          .map(
            (line, index) =>
              `<text x="120" y="${
                411 + index * 40
              }" fill="#111111" font-family="Arial, sans-serif" font-size="31" font-weight="700">${escapeXml(
                line
              )}</text>`
          )
          .join('')}
        <text x="88" y="548" fill="#8b8b86" font-family="Arial, sans-serif" font-size="17">${itemCount} ${
      itemCount === 1 ? 'post' : 'posts'
    } on ${surfaceName}</text>
        <text x="1112" y="548" text-anchor="end" fill="#8b8b86" font-family="Arial, sans-serif" font-size="17">Powered by Slipway</text>
      </svg>`

    return new Resvg(svg, {
      fitTo: { mode: 'width', value: 1200 },
      font: { loadSystemFonts: true, defaultFontFamily: 'Arial' }
    })
      .render()
      .asPng()
  }
}

function titleCase(value) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function emptyTitle(surface) {
  return {
    feedback: 'Be the first to share useful feedback',
    roadmap: 'The next chapter is being shaped now',
    updates: 'The latest improvements will appear here'
  }[surface]
}

function statusLabel(status) {
  return {
    reviewing: 'Reviewing',
    planned: 'Planned',
    in_progress: 'In progress',
    shipped: 'Shipped',
    closed: 'Closed',
    published: 'Published'
  }[status]
}

function votes(count) {
  if (!Number.isFinite(count)) return ''
  return `${count} ${count === 1 ? 'vote' : 'votes'}`
}

function wrap(value, width, limit) {
  const words = String(value || '')
    .trim()
    .split(/\s+/)
  const lines = []
  let line = ''
  let truncated = false
  for (const word of words) {
    if (`${line} ${word}`.trim().length <= width) {
      line = `${line} ${word}`.trim()
      continue
    }
    if (line) lines.push(line)
    line = word
    if (lines.length === limit - 1) {
      truncated = true
      break
    }
  }
  if (line && lines.length < limit) lines.push(line)
  if (truncated && lines.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1]}…`
  }
  return lines
}

function escapeXml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}
