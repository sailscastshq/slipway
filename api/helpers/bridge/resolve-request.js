const crypto = require('crypto')
const {
  internalBridgeApiBasePath,
  internalBridgeBasePath,
  publicBridgeBasePath,
  publicBridgeCallbackPath
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
    reauthenticate: { outputType: 'string' },
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

    // A Slipway operator enters Bridge with their existing project/team
    // authorization. App-local invitations are a separate public-host flow
    // and are resolved above through the dedicated Bridge session.
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
    const app = await findHostSessionApp({
      req,
      projectSlug,
      environmentSlug,
      appSlug
    })
    invalidateBridgeSession(req, app, true)
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
    String(req.session.bridgeAppId) !== String(app.id)
  ) {
    const requestedApp = await findHostSessionApp({
      req,
      projectSlug,
      environmentSlug,
      appSlug
    })
    invalidateBridgeSession(req, requestedApp, true)
  }
  if (
    !safeEqual(
      req.session.bridgeCredentialHash,
      hashCredential(app.bridgeSecret)
    )
  ) {
    invalidateBridgeSession(req, app, true)
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

async function findHostSessionApp({
  req,
  projectSlug,
  environmentSlug,
  appSlug
}) {
  if (req.session.bridgeHostOrigin !== true) {
    return null
  }

  if (projectSlug && environmentSlug && appSlug) {
    const project = await Project.findOne({ slug: projectSlug })
    const environment = project
      ? await Environment.findOne({
          project: project.id,
          slug: environmentSlug
        })
      : null
    const requestedApp = environment
      ? await App.findOne({
          environment: environment.id,
          slug: appSlug,
          bridgeEnabled: true
        })
      : null

    if (requestedApp) return requestedApp
  }

  return req.session.bridgeAppId
    ? App.findOne({
        id: req.session.bridgeAppId,
        bridgeEnabled: true
      })
    : null
}

function invalidateBridgeSession(req, app = null, mayReauthenticate = false) {
  const callback =
    mayReauthenticate &&
    req.session.bridgeHostOrigin === true &&
    app?.bridgeEnabled
      ? publicBridgeCallbackPath(app)
      : null

  clearBridgeSession(req)

  if (callback) {
    throw { reauthenticate: callback }
  }
  throw 'forbidden'
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
