import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.cwd()
const sourceRoot = join(root, 'assets/js')
const geometryAttributes = new Set([
  'cx',
  'cy',
  'd',
  'height',
  'points',
  'r',
  'rx',
  'ry',
  'width',
  'x',
  'x1',
  'x2',
  'y',
  'y1',
  'y2'
])

function filesUnder(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const absolute = join(directory, entry)
    if (statSync(absolute).isDirectory()) return filesUnder(absolute)
    return /\.(?:vue|js|mjs)$/.test(entry) ? [absolute] : []
  })
}

function normalizeGeometry(svg) {
  const shapes = []
  const shapePattern =
    /<(path|circle|rect|line|polyline|polygon|ellipse)\b([^>]*)\/?\s*>/g

  for (const match of svg.matchAll(shapePattern)) {
    const attributes = []

    for (const attribute of match[2].matchAll(
      /([:\w-]+)=(?:"([^"]*)"|'([^']*)')/g
    )) {
      if (!geometryAttributes.has(attribute[1])) continue

      attributes.push([
        attribute[1],
        (attribute[2] ?? attribute[3]).replace(/\s+/g, ' ').trim()
      ])
    }

    shapes.push([match[1], attributes.sort(([a], [b]) => a.localeCompare(b))])
  }

  return JSON.stringify(shapes)
}

const productBrandGeometry = new Set([
  '34de08f91a21', // Telegram
  '4f4bd247754b', // GitHub
  '952fad0ecf01', // Git
  'a98732b0f7c9', // GitHub
  'decafe684373', // Discord
  'eb4516aa872e' // Slack
])

const intentionalCategories = new Set([
  'brand-or-motion',
  'data-visualization',
  'klean-primitive-internal',
  'product-brand-mark',
  'video-artwork'
])

function classify(file, hash) {
  if (file.includes('/components/ui/icons/')) return 'installed-klean-icon'
  if (file.includes('/components/ui/')) return 'klean-primitive-internal'
  if (/(?:SlipwayLogo|SlippyLoader)\.vue$/.test(file)) return 'brand-or-motion'
  if (file.includes('/videos/')) return 'video-artwork'
  if (productBrandGeometry.has(hash)) return 'product-brand-mark'
  if (file.endsWith('/components/bridge/BridgeDashboard.vue')) {
    return 'data-visualization'
  }
  if (file.includes('/layouts/')) return 'application-shell'
  if (file.includes('/components/bridge/')) return 'bridge-component'
  if (file.includes('/components/')) return 'application-component'
  if (file.includes('/pages/')) return 'page'
  return 'other'
}

const usages = []

for (const absolute of filesUnder(sourceRoot)) {
  const source = readFileSync(absolute, 'utf8')
  const sourceLines = source.split('\n')

  for (const match of source.matchAll(/<svg\b[\s\S]*?<\/svg>/g)) {
    const geometry = normalizeGeometry(match[0])
    const line = source.slice(0, match.index).split('\n').length
    const hash = createHash('sha256')
      .update(geometry)
      .digest('hex')
      .slice(0, 12)

    usages.push({
      file: relative(root, absolute),
      line,
      hash,
      geometry,
      category: classify(absolute, hash),
      context: sourceLines
        .slice(Math.max(0, line - 3), Math.min(sourceLines.length, line + 5))
        .map((value) => value.trim())
        .filter(Boolean)
        .join(' ')
    })
  }
}

const candidates = usages.filter(
  ({ category }) => category !== 'installed-klean-icon'
)
const groups = [...Map.groupBy(candidates, ({ hash }) => hash)].map(
  ([hash, entries]) => ({
    hash,
    count: entries.length,
    geometry: entries[0].geometry,
    entries: entries.map(({ file, line, category, context }) => ({
      file,
      line,
      category,
      context
    }))
  })
)

groups.sort((a, b) => b.count - a.count || a.hash.localeCompare(b.hash))

const categoryCounts = Object.entries(
  candidates.reduce((counts, { category }) => {
    counts[category] = (counts[category] || 0) + 1
    return counts
  }, {})
).sort(([, a], [, b]) => b - a)

const report = {
  installedKleanIconSvgs: usages.length - candidates.length,
  remainingInlineSvgs: candidates.length,
  consumerInterfaceInlineSvgs: candidates.filter(
    ({ category }) => !intentionalCategories.has(category)
  ).length,
  uniqueGeometry: groups.length,
  repeatedGeometry: groups.filter(({ count }) => count > 1).length,
  categoryCounts,
  groups
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`installedKleanIconSvgs\t${report.installedKleanIconSvgs}`)
  console.log(`remainingInlineSvgs\t${report.remainingInlineSvgs}`)
  console.log(
    `consumerInterfaceInlineSvgs\t${report.consumerInterfaceInlineSvgs}`
  )
  console.log(`uniqueGeometry\t${report.uniqueGeometry}`)
  console.log(`repeatedGeometry\t${report.repeatedGeometry}`)
  console.log(`categories\t${JSON.stringify(categoryCounts)}`)

  for (const group of groups) {
    const locations = group.entries
      .slice(0, 6)
      .map(({ file, line }) => `${file}:${line}`)
      .join(',')

    console.log(
      [group.count, group.hash, group.geometry.slice(0, 320), locations].join(
        '\t'
      )
    )
  }
}
