const crypto = require('node:crypto')
const { isHostOriginRequest } = require('../../lib/bridge-paths')

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
    const instanceUrl = await sails.helpers.getInstanceUrl()
    const hostOrigin = isHostOriginRequest(req, instanceUrl)
    const internalBasePath = `/bearing/public/${encodeURIComponent(
      project.slug
    )}/${encodeURIComponent(environment.slug)}/${encodeURIComponent(app.slug)}`
    return {
      project,
      environment,
      app,
      space,
      participant,
      publicBasePath: hostOrigin ? `${routePrefix}/bearing` : internalBasePath,
      identityPath: hostOrigin
        ? `${routePrefix}/_slipway/bearing/identity`
        : `${internalBasePath}/_slipway/bearing/identity`,
      hostAssetBasePath: hostOrigin
        ? `${routePrefix}/_slipway/bearing/_assets`
        : ''
    }
  }
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
