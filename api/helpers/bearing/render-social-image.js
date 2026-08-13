const { Resvg } = require('@resvg/resvg-js')

const FONT = {
  family: 'DejaVu Sans',
  files: [
    require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf'),
    require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf')
  ]
}

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
        <text x="88" y="104" fill="#161616" font-family="${
          FONT.family
        }" font-size="23" font-weight="700">${escapeXml(appName)}</text>
        <text x="88" y="137" fill="#777773" font-family="${
          FONT.family
        }" font-size="20">${surfaceName}</text>
        <rect x="964" y="68" width="148" height="148" rx="30" fill="#17171a"/>
        <svg x="996" y="84" width="84" height="84" viewBox="0 0 32 32" fill="none">
          <path d="M7 17 C7 3 25 3 25 17 Z" stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M7 17 C4 21 4 25 8 28" stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round"/>
          <path d="M12 17 C11 21 10 25 13 28" stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round"/>
          <path d="M20 17 C21 21 22 25 19 28" stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round"/>
          <path d="M25 17 C28 21 28 25 24 28" stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round"/>
          <circle cx="13" cy="11" r="1.8" fill="#38bdf8"/>
          <circle cx="19" cy="11" r="1.8" fill="#38bdf8"/>
        </svg>
        <text x="1038" y="198" text-anchor="middle" fill="#d4d4d8" font-family="${
          FONT.family
        }" font-size="12" font-weight="700" letter-spacing="2.5">SLIPWAY</text>
        <text x="88" y="203" fill="#969691" font-family="${
          FONT.family
        }" font-size="16" font-weight="700" letter-spacing="3">BEARING</text>
        <text x="88" y="263" fill="#111111" font-family="${
          FONT.family
        }" font-size="46" font-weight="700">${escapeXml(headline)}</text>
        <rect x="88" y="310" width="1024" height="176" rx="24" fill="#f7f7f5"/>
        <circle cx="128" cy="350" r="9" fill="#171717"/>
        <text x="153" y="356" fill="#73736f" font-family="${
          FONT.family
        }" font-size="18">${escapeXml(meta)}</text>
        ${titleLines
          .map(
            (line, index) =>
              `<text x="120" y="${
                411 + index * 40
              }" fill="#111111" font-family="${
                FONT.family
              }" font-size="31" font-weight="700">${escapeXml(line)}</text>`
          )
          .join('')}
        <text x="88" y="548" fill="#8b8b86" font-family="${
          FONT.family
        }" font-size="17">${itemCount} ${
      itemCount === 1 ? 'post' : 'posts'
    } on ${surfaceName}</text>
      </svg>`

    return new Resvg(svg, {
      fitTo: { mode: 'width', value: 1200 },
      font: {
        fontFiles: FONT.files,
        loadSystemFonts: false,
        defaultFontFamily: FONT.family
      }
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
