const fs = require('node:fs')
const path = require('node:path')

const MAX_MANIFEST_BYTES = 131072
const MAX_ASSETS = 32
const CACHE_MS = 1000
const ASSET_PATH = /^\/(js|css)\/(?:async\/)?[\w-]+\.[a-f\d]{8,}\.(js|css)$/
let cached

function readBoundedJson(filename) {
  const stat = fs.statSync(filename)
  if (!stat.isFile() || stat.size > MAX_MANIFEST_BYTES) return null
  const source = fs.readFileSync(filename)
  if (source.length > MAX_MANIFEST_BYTES) return null
  return JSON.parse(source)
}

module.exports = function questAssetPreloads({ appPath, development = false }) {
  if (development || typeof appPath !== 'string') return []
  const root = path.resolve(appPath, '.tmp/public')
  const now = Date.now()
  if (cached?.root === root && now >= cached.at && now - cached.at < CACHE_MS)
    return cached.assets

  let assets = []
  try {
    const manifest = readBoundedJson(
      path.join(root, 'quest-preload-manifest.json')
    )
    const build = readBoundedJson(path.join(root, 'manifest.json'))
    if (
      manifest?.version === 1 &&
      manifest.mode === 'production' &&
      manifest.page === 'projects/quest' &&
      Array.isArray(manifest.assets) &&
      manifest.assets.length <= MAX_ASSETS &&
      Array.isArray(build?.allFiles)
    ) {
      const initial = new Set([
        ...(build.entries?.app?.initial?.js || []),
        ...(build.entries?.app?.initial?.css || [])
      ])
      const available = new Set(build.allFiles)
      const valid = manifest.assets.every((asset) => {
        const match = typeof asset === 'string' && asset.match(ASSET_PATH)
        return (
          match &&
          match[1] === match[2] &&
          available.has(asset) &&
          !initial.has(asset)
        )
      })
      if (valid)
        assets = [...new Set(manifest.assets)].map((href) =>
          Object.freeze({ href, as: href.endsWith('.js') ? 'script' : 'style' })
        )
    }
  } catch {
    // Missing/stale builds and malformed metadata must never block the page.
  }
  assets = Object.freeze(assets)
  // A single bounded cache entry also caches misses. Development never reads
  // it, and a rebuilt/replaced production manifest is observed within a second.
  cached = { root, at: now, assets }
  return assets
}
