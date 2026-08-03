const crypto = require('crypto')
const {
  internalBridgeApiBasePath,
  internalBridgeBasePath,
  publicBridgeBasePath
} = require('../../lib/bridge-paths')

const ROLE_RANK = {
  viewer: 1,
  editor: 2,
  administrator: 3
}

module.exports = {
  friendlyName: 'Resolve Bridge request',

  description:
    'Resolve either a Slipway operator or an invited host-app Bridge session.',

  inputs: {
    req: { type: 'ref', required: true },
    projectSlug: { type: 'string', required: true },
    environmentSlug: { type: 'string', defaultsTo: 'production' },
    appSlug: { type: 'string' },
    requiredRole: {
      type: 'string',
      isIn: ['viewer', 'editor', 'administrator'],
      defaultsTo: 'viewer'
    },
    requireRunning: {
      type: 'boolean',
      defaultsTo: false
    }
  },

  exits: {
    success: { outputType: 'ref' },
    forbidden: {},
    notFound: {},
    appNotRunning: {}
  },

  fn: async function ({
    req,
    projectSlug,
    environmentSlug,
    appSlug,
    requiredRole,
    requireRunning
  }) {
    const bridgeAccessId = req.session.bridgeAccessId
    if (bridgeAccessId) {
      return resolveHostSession({
        req,
        bridgeAccessId,
        projectSlug,
        environmentSlug,
        appSlug,
        requiredRole,
        requireRunning
      })
    }

    const resolved = await sails.helpers.resolveApp
      .with({
        req,
        projectSlug,
        environmentSlug,
        ...(appSlug ? { appSlug } : {}),
        requireRunning
      })
      .intercept('forbidden', 'forbidden')
      .intercept('notFound', 'notFound')
      .intercept('appNotRunning', 'appNotRunning')

    // Existing dashboard Bridge remains available to the team until app-local
    // Bridge is enabled. Once enabled, every person must first prove a matching
    // host-app account through /bridge.
    if (!resolved.app.bridgeEnabled) {
      const actor = await sails.helpers.bridge.buildActor.with({
        user: resolved.user,
        project: resolved.project,
        environment: resolved.environment
      })
      return {
        ...resolved,
        actor,
        actorId: String(resolved.user.id),
        auditUserId: String(resolved.user.id),
        access: null,
        ...requestPaths({
          req,
          project: resolved.project,
          environment: resolved.environment,
          app: resolved.app,
          appScoped: Boolean(appSlug)
        })
      }
    }

    const access = await BridgeAccess.findOne({
      app: resolved.app.id,
      email: resolved.user.email.toLowerCase(),
      status: 'active'
    })
    if (!access || !roleAllows(access.role, requiredRole)) {
      throw 'forbidden'
    }

    const actor = await sails.helpers.bridge.buildAccessActor.with({
      access,
      project: resolved.project,
      environment: resolved.environment,
      app: resolved.app
    })
    return {
      ...resolved,
      actor,
      actorId: actor.id,
      auditUserId: String(resolved.user.id),
      access,
      ...requestPaths({
        req,
        project: resolved.project,
        environment: resolved.environment,
        app: resolved.app,
        appScoped: Boolean(appSlug)
      })
    }
  }
}

async function resolveHostSession({
  req,
  bridgeAccessId,
  projectSlug,
  environmentSlug,
  appSlug,
  requiredRole,
  requireRunning
}) {
  if (
    !req.session.bridgeAuthenticatedAt ||
    Date.now() - req.session.bridgeAuthenticatedAt > 8 * 60 * 60 * 1000
  ) {
    clearBridgeSession(req)
    throw 'forbidden'
  }

  const access = await BridgeAccess.findOne({
    id: bridgeAccessId,
    status: 'active'
  })
  const app = access
    ? await App.findOne({
        id: access.app,
        bridgeEnabled: true
      }).decrypt()
    : null
  const environment = app
    ? await Environment.findOne({
        id: app.environment,
        slug: environmentSlug
      })
    : null
  const project = environment
    ? await Project.findOne({
        id: environment.project,
        slug: projectSlug
      })
    : null

  if (
    !access ||
    !app ||
    !environment ||
    !project ||
    (appSlug && app.slug !== appSlug) ||
    String(req.session.bridgeAppId) !== String(app.id) ||
    !safeEqual(
      req.session.bridgeCredentialHash,
      hashCredential(app.bridgeSecret)
    )
  ) {
    clearBridgeSession(req)
    throw 'forbidden'
  }
  if (!roleAllows(access.role, requiredRole)) {
    throw 'forbidden'
  }

  if (requireRunning && (app.status !== 'running' || !app.containerName)) {
    throw 'appNotRunning'
  }

  const actor = await sails.helpers.bridge.buildAccessActor.with({
    access,
    project,
    environment,
    app
  })
  return {
    user: null,
    project,
    environment,
    app,
    apps: [app],
    actor,
    actorId: actor.id,
    auditUserId: null,
    access,
    ...requestPaths({
      req,
      project,
      environment,
      app,
      appScoped: Boolean(appSlug)
    })
  }
}

function requestPaths({ req, project, environment, app, appScoped }) {
  const hostOrigin = req.session.bridgeHostOrigin === true
  const internalBasePath = internalBridgeBasePath(
    project,
    environment,
    app,
    appScoped
  )
  const bridgeBasePath = hostOrigin
    ? publicBridgeBasePath(app)
    : internalBasePath

  if (hostOrigin && typeof req.url === 'string') {
    req.url = replacePathPrefix(req.url, internalBasePath, bridgeBasePath)
  }

  return {
    bridgeBasePath,
    bridgeApiBasePath: hostOrigin
      ? bridgeBasePath
      : internalBridgeApiBasePath(project, environment, app, appScoped),
    bridgeAssetBasePath: hostOrigin ? `${bridgeBasePath}/_assets` : '',
    bridgeHostOrigin: hostOrigin
  }
}

function replacePathPrefix(url, currentPrefix, publicPrefix) {
  return url === currentPrefix ||
    url.startsWith(`${currentPrefix}/`) ||
    url.startsWith(`${currentPrefix}?`)
    ? `${publicPrefix}${url.slice(currentPrefix.length)}`
    : url
}

function roleAllows(actual, required) {
  return ROLE_RANK[actual] >= ROLE_RANK[required]
}

function clearBridgeSession(req) {
  delete req.session.bridgeAccessId
  delete req.session.bridgeAppId
  delete req.session.bridgeAuthenticatedAt
  delete req.session.bridgeCredentialHash
  delete req.session.bridgeHostOrigin
}

function hashCredential(value) {
  return crypto
    .createHash('sha256')
    .update(String(value || ''))
    .digest('hex')
}

function safeEqual(left, right) {
  if (!left || !right) return false
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  )
}
