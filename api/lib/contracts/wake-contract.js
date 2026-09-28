const CAMPAIGNS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content'
]
function settings(value = {}) {
  const origins = Array.isArray(value.allowedOrigins)
    ? value.allowedOrigins
    : []
  return {
    mode: value.mode === 'cookieless' ? 'cookieless' : 'first-party',
    requireConsent: value.requireConsent !== false,
    respectPrivacySignals: value.respectPrivacySignals !== false,
    allowedOrigins: [
      ...new Set(
        origins
          .slice(0, 20)
          .map((value) => {
            try {
              const url = new URL(value)
              return /^https?:$/.test(url.protocol) &&
                !url.username &&
                !url.password &&
                url.pathname === '/' &&
                !url.search &&
                !url.hash
                ? url.origin
                : null
            } catch {
              return null
            }
          })
          .filter(Boolean)
      )
    ],
    excludedPaths: (Array.isArray(value.excludedPaths)
      ? value.excludedPaths
      : []
    )
      .filter(
        (path) =>
          typeof path === 'string' && /^\/[a-zA-Z0-9/_.*-]{0,200}$/.test(path)
      )
      .slice(0, 50)
  }
}
function cleanPath(value) {
  if (
    typeof value !== 'string' ||
    value.length > 2048 ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    /[\x00-\x20\\]/.test(value)
  )
    throw new Error('invalid path')
  return value.split(/[?#]/, 1)[0]
}
function excluded(path, config, prefix = '') {
  let normalized
  try {
    normalized = decodeURIComponent(cleanPath(path))
  } catch {
    return true
  }
  const local =
    prefix && normalized.startsWith(prefix + '/')
      ? normalized.slice(prefix.length)
      : normalized
  return (
    /^\/(?:_slipway|__|health(?:\/|$)|assets(?:\/|$))/i.test(local) ||
    /\.(?:js|css|png|jpe?g|svg|ico|map|woff2?|webp|gif)$/i.test(local) ||
    config.excludedPaths.some((entry) =>
      entry.endsWith('*')
        ? normalized.startsWith(entry.slice(0, -1))
        : normalized === entry
    )
  )
}
function dimensions(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('invalid dimensions')
  if (
    Object.keys(value).some(
      (key) => !['referrer', 'campaign', 'device', 'country'].includes(key)
    )
  )
    throw new Error('unknown dimensions')
  let referrer = ''
  if (typeof value.referrer === 'string' && value.referrer.length <= 2048) {
    try {
      const url = new URL(value.referrer)
      if (/^https?:$/.test(url.protocol) && !url.username && !url.password)
        referrer = url.origin + cleanPath(url.pathname)
    } catch {
      /* omit malformed referrers */
    }
  }
  const campaign = {}
  for (const key of CAMPAIGNS) {
    const item = value.campaign?.[key]
    if (typeof item === 'string')
      campaign[key] = item.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 120)
  }
  return {
    referrer,
    campaign,
    device: ['mobile', 'tablet', 'desktop'].includes(value.device)
      ? value.device
      : 'unknown',
    country: 'Unknown'
  }
}
module.exports = { settings, cleanPath, excluded, dimensions, CAMPAIGNS }
