const {
  isHostOriginRequest,
  publicBridgeCallbackPath
} = require('../lib/bridge-paths')

module.exports = async function (req, res, proceed) {
  if (req.session.userId || req.session.bridgeAccessId) {
    return proceed()
  }

  const instanceUrl = await sails.helpers.getInstanceUrl()
  if (isHostOriginRequest(req, instanceUrl)) {
    const app = await resolveProxiedApp(req.allParams())
    if (app) {
      const invitation =
        typeof req.query?.invite === 'string'
          ? `?invite=${encodeURIComponent(req.query.invite)}`
          : ''
      const callback = `${publicBridgeCallbackPath(app)}${invitation}`

      if (req.get('X-Inertia') === 'true') {
        return res.status(409).set('X-Inertia-Location', callback).send('')
      }

      if (acceptsHtml(req)) {
        return res.redirect(callback)
      }
    }
  }

  if (req.wantsJSON && req.get('X-Inertia') !== 'true') {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Bridge authentication required.'
    })
  }

  return res.redirect('/login')
}

function acceptsHtml(req) {
  return String(req.get('accept') || '').includes('text/html')
}

async function resolveProxiedApp(params) {
  if (!params?.slug || !params?.envSlug || !params?.appSlug) return null

  const project = await Project.findOne({ slug: params.slug })
  const environment = project
    ? await Environment.findOne({
        project: project.id,
        slug: params.envSlug
      })
    : null
  return environment
    ? App.findOne({
        environment: environment.id,
        slug: params.appSlug,
        bridgeEnabled: true
      })
    : null
}
