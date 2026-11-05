const key = (id) => `beacon.public.app:${id}`
const prefix = (app) =>
  !app.routePath || app.routePath === '/'
    ? ''
    : `/${String(app.routePath).replace(/^\/+|\/+$/g, '')}`
const publicPath = (app) => `${prefix(app)}/beacon`
const internalPath = (project, environment, app) =>
  `/_slipway/beacon/host/${encodeURIComponent(
    project.slug
  )}/${encodeURIComponent(environment.slug)}/${encodeURIComponent(app.slug)}`
function enabled(value) {
  try {
    return JSON.parse(value).enabled === true
  } catch {
    return false
  }
}
function conflict(app, siblings) {
  if (app.routePath === null)
    return 'Workers cannot serve a public Beacon page.'
  const mount = prefix(app)
  if (
    !/^(\/[a-zA-Z0-9._-]+)*$/.test(mount) ||
    mount.split('/').some((s) => s === '.' || s === '..') ||
    /(?:^|\/)(?:_slipway|bridge|bearing|beacon|\.well-known)(?:\/|$)/i.test(
      mount
    )
  ) {
    return 'This reserved or ambiguous app mount cannot serve Beacon.'
  }
  const targets = [publicPath(app), `${prefix(app)}/_slipway/beacon`]
  const healthPaths = [
    app.healthPath,
    app.healthPath ? mount + app.healthPath : null
  ].filter(Boolean)
  if (
    targets.some((target) =>
      healthPaths.some(
        (health) => health === target || health.startsWith(target + '/')
      )
    )
  )
    return 'Beacon conflicts with this app’s health path.'
  for (const sibling of siblings) {
    if (String(sibling.id) === String(app.id) || sibling.routePath === null)
      continue
    const other = prefix(sibling).toLowerCase()
    if (
      other === mount.toLowerCase() ||
      (other &&
        targets.some(
          (target) =>
            target.toLowerCase().startsWith(other) ||
            other.startsWith(target.toLowerCase() + '/')
        ))
    ) {
      return 'Beacon conflicts with another app mount in this environment.'
    }
  }
  return null
}
module.exports = { key, prefix, publicPath, internalPath, enabled, conflict }
