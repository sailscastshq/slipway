function normalizeRoutePath(routePath) {
  if (!routePath || routePath === '/') return ''
  return `/${String(routePath).replace(/^\/+|\/+$/g, '')}`
}

function publicBridgeBasePath(app) {
  return `${normalizeRoutePath(app?.routePath)}/bridge`
}

function publicBridgeCallbackPath(app) {
  return `${normalizeRoutePath(app?.routePath)}/_slipway/bridge`
}

function internalBridgeBasePath(project, environment, app, appScoped = true) {
  const environmentPath = `/projects/${project.slug}/environments/${environment.slug}`
  return appScoped
    ? `${environmentPath}/apps/${app.slug}/bridge`
    : `${environmentPath}/bridge`
}

function internalBridgeApiBasePath(
  project,
  environment,
  app,
  appScoped = true
) {
  const environmentPath = `/api/v1/projects/${project.slug}/environments/${environment.slug}`
  return appScoped
    ? `${environmentPath}/apps/${app.slug}/bridge`
    : `${environmentPath}/bridge`
}

function isHostOriginRequest(req, instanceUrl) {
  const requestHost = normalizeHostname(
    req?.get?.('x-forwarded-host') || req?.get?.('host') || req?.hostname
  )
  const instanceHost = hostnameFromUrl(instanceUrl)
  return Boolean(requestHost && instanceHost && requestHost !== instanceHost)
}

function hostnameFromUrl(value) {
  try {
    return new URL(value).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function normalizeHostname(value) {
  const first = String(value || '')
    .split(',')[0]
    .trim()
    .toLowerCase()
  if (!first) return ''

  try {
    return new URL(`http://${first}`).hostname.toLowerCase()
  } catch {
    return ''
  }
}

module.exports = {
  internalBridgeApiBasePath,
  internalBridgeBasePath,
  isHostOriginRequest,
  normalizeRoutePath,
  publicBridgeBasePath,
  publicBridgeCallbackPath
}
