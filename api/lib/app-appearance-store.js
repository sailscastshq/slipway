const { normalize, warnings, palettes } = require('./app-appearance')
const keyFor = (app) => `app-appearance:v1:${app.id}`
async function read(app) {
  const record = await Setting.findOne({ key: keyFor(app) })
  try {
    const value = JSON.parse(record?.value || '{}')
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : {}
  } catch {
    return {}
  }
}
function logoPath(base, slot, value) {
  return value?.data && /^[a-f0-9]{16}$/.test(value.hash)
    ? `${base}/appearance/logo/${slot}?v=${value.hash}`
    : null
}
function present(stored, app, base, fallbackName = app.name) {
  const resolved = normalize(stored, fallbackName)
  for (const mode of ['light', 'dark']) {
    if (
      warnings({
        ...resolved,
        [mode === 'light' ? 'dark' : 'light']:
          palettes[mode === 'light' ? 'dark' : 'light']
      }).length
    )
      resolved[mode] = { ...palettes[mode] }
  }
  return {
    ...resolved,
    configured: stored?.version === 1,
    logoLight: logoPath(base, 'light', stored.logoLight),
    logoDark: logoPath(base, 'dark', stored.logoDark)
  }
}
async function resolve(app, base, fallbackName) {
  return present(await read(app), app, base, fallbackName)
}
module.exports = { keyFor, read, present, resolve }
