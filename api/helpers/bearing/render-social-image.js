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
        <defs>
          <linearGradient id="signal" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#0284c7"/>
            <stop offset="1" stop-color="#38bdf8"/>
          </linearGradient>
          <radialGradient id="glow" cx="0" cy="0" r="1" gradientTransform="translate(1040 40) rotate(135) scale(420 360)">
            <stop offset="0" stop-color="#0ea5e9" stop-opacity="0.17"/>
            <stop offset="1" stop-color="#0ea5e9" stop-opacity="0"/>
          </radialGradient>
        </defs>

        <rect width="1200" height="630" fill="#09090b"/>
        <rect width="1200" height="630" fill="url(#glow)"/>
        <rect x="32" y="32" width="1136" height="566" rx="32" fill="none" stroke="#27272a"/>
        <path d="M72 164 H1128" stroke="#27272a" stroke-dasharray="5 9"/>

        <svg x="70" y="57" width="48" height="48" viewBox="0 0 32 32" fill="none">
          <path d="M7 17 C7 3 25 3 25 17 Z" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="#0ea5e9" fill-opacity="0.08"/>
          <path d="M7 17 C4 21 4 25 8 28" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round"/>
          <path d="M12 17 C11 21 10 25 13 28" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round"/>
          <path d="M20 17 C21 21 22 25 19 28" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round"/>
          <path d="M25 17 C28 21 28 25 24 28" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round"/>
          <circle cx="13" cy="11" r="1.5" fill="#38bdf8"/>
          <circle cx="19" cy="11" r="1.5" fill="#38bdf8"/>
        </svg>
        <text x="132" y="88" fill="#fafafa" font-family="${
          FONT.family
        }" font-size="27" font-weight="700" letter-spacing="-1">slipway</text>
        <rect x="252" y="61" width="104" height="35" rx="17.5" fill="#18181b" stroke="#3f3f46"/>
        <text x="304" y="84" text-anchor="middle" fill="#a1a1aa" font-family="${
          FONT.family
        }" font-size="12" font-weight="700" letter-spacing="2">BEARING</text>

        <text x="1128" y="84" text-anchor="end" fill="#fafafa" font-family="${
          FONT.family
        }" font-size="22" font-weight="700">${escapeXml(
      truncate(appName, 34)
    )}</text>
        <text x="1128" y="117" text-anchor="end" fill="#38bdf8" font-family="${
          FONT.family
        }" font-size="13" font-weight="700" letter-spacing="1.8">${escapeXml(
      surfaceName.toUpperCase()
    )}</text>

        <text x="88" y="263" fill="#fafafa" font-family="${
          FONT.family
        }" font-size="48" font-weight="700" letter-spacing="-1.8">${escapeXml(
      headline
    )}</text>

        <rect x="88" y="310" width="1024" height="182" rx="20" fill="#131316" stroke="#27272a"/>
        <text x="128" y="357" fill="#a1a1aa" font-family="${
          FONT.family
        }" font-size="15" font-weight="700" letter-spacing="1.2">${escapeXml(
      meta.toUpperCase()
    )}</text>
        ${titleLines
          .map(
            (line, index) =>
              `<text x="128" y="${
                419 + index * 39
              }" fill="#f4f4f5" font-family="${
                FONT.family
              }" font-size="31" font-weight="700" letter-spacing="-0.5">${escapeXml(
                line
              )}</text>`
          )
          .join('')}

        <text x="88" y="558" fill="#71717a" font-family="${
          FONT.family
        }" font-size="13" font-weight="700" letter-spacing="1.5">${itemCount} ${
      itemCount === 1 ? 'POST' : 'POSTS'
    }</text>
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

function truncate(value, limit) {
  const string = String(value || '')
  return string.length > limit ? `${string.slice(0, limit - 1)}…` : string
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
