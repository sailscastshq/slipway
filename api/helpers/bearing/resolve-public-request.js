const crypto = require('node:crypto')

module.exports = {
  friendlyName: 'Resolve public Bearing request',

  description:
    'Resolve an enabled app-owned Bearing space and its optional participant.',

  inputs: {
    req: { type: 'ref', required: true },
    projectSlug: { type: 'string', required: true },
    environmentSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true }
  },

  exits: {
    success: { outputType: 'ref' },
    notFound: { description: 'Bearing is unavailable for this app.' }
  },

  fn: async function ({ req, projectSlug, environmentSlug, appSlug }) {
    const project = await Project.findOne({ slug: projectSlug })
    const environment = project
      ? await Environment.findOne({
          project: project.id,
          slug: environmentSlug
        })
      : null
    const app = environment
      ? await App.findOne({
          environment: environment.id,
          slug: appSlug,
          bearingEnabled: true
        }).decrypt()
      : null
    const space = app ? await BearingSpace.findOne({ app: app.id }) : null

    if (!project || !environment || !app || !space) throw 'notFound'

    let participant = null
    if (
      String(req.session?.bearingAppId || '') === String(app.id) &&
      req.session?.bearingCredentialHash === hashCredential(app.bearingSecret)
    ) {
      participant = await BearingParticipant.findOne({
        id: req.session.bearingParticipantId,
        space: space.id
      })
      if (participant?.disabledAt) participant = null
    }

    if (!participant && req.session) clearBearingSession(req.session)

    const routePrefix = normalizeRoutePrefix(app.routePath)
    const integrationBasePath = `${routePrefix}/_slipway/bearing`
    const internalBasePath = `/_slipway/bearing/host/${encodeURIComponent(
      project.slug
    )}/${encodeURIComponent(environment.slug)}/${encodeURIComponent(app.slug)}`
    const publicBasePath = `${routePrefix}/bearing`

    // Caddy sends the private renderer path to Slipway, but Inertia uses
    // req.url as the browser-history URL. Restore the app-owned namespace
    // before the page object is built, just as Bridge does for host requests.
    if (typeof req.url === 'string') {
      req.url = replacePathPrefix(req.url, internalBasePath, publicBasePath)
    }

    return {
      project,
      environment,
      app,
      space,
      participant,
      requestBasePath: internalBasePath,
      publicBasePath,
      integrationBasePath,
      homeUrl: absoluteUrl(req, routePrefix || '/'),
      identityPath: `${integrationBasePath}/identity`,
      hostAssetBasePath: `${integrationBasePath}/_assets`
    }
  }
}

function absoluteUrl(req, path) {
  const protocol = req.get('x-forwarded-proto') || req.protocol || 'https'
  const host =
    req.get('x-forwarded-host') ||
    req.get('host') ||
    req.hostname ||
    'localhost'
  return `${protocol}://${host}${path}`
}

function replacePathPrefix(url, currentPrefix, publicPrefix) {
  return url === currentPrefix ||
    url.startsWith(`${currentPrefix}/`) ||
    url.startsWith(`${currentPrefix}?`)
    ? `${publicPrefix}${url.slice(currentPrefix.length)}`
    : url
}

function hashCredential(value) {
  return crypto
    .createHash('sha256')
    .update(String(value || ''))
    .digest('hex')
}

function normalizeRoutePrefix(routePath) {
  if (!routePath || routePath === '/') return ''
  return `/${String(routePath).replace(/^\/+|\/+$/g, '')}`
}

function clearBearingSession(session) {
  for (const key of [
    'bearingParticipantId',
    'bearingAppId',
    'bearingAuthenticatedAt',
    'bearingCredentialHash'
  ]) {
    delete session[key]
  }
}
