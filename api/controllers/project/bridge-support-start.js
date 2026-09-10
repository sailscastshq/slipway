const crypto = require('node:crypto')
const grants = require('../../lib/bridge-support-grants')
module.exports = {
  friendlyName: 'Start read-only Bridge support view',
  inputs: {
    slug: { type: 'string', required: true },
    envSlug: { type: 'string', defaultsTo: 'production' },
    appSlug: { type: 'string', required: true },
    modelIdentity: { type: 'string', required: true },
    recordId: { type: 'string', required: true, maxLength: 256 },
    reason: { type: 'string', required: true, minLength: 10, maxLength: 500 },
    password: { type: 'string', required: true, maxLength: 256 }
  },
  exits: {
    success: { statusCode: 200 },
    forbidden: { statusCode: 403 },
    badRequest: { responseType: 'badRequest' }
  },
  fn: async function ({
    slug,
    envSlug,
    appSlug,
    modelIdentity,
    recordId,
    reason,
    password
  }) {
    if (reason.trim().length < 10)
      throw {
        badRequest: {
          message: 'Give a specific reason of at least ten characters.'
        }
      }
    const user = await User.forRequest(this.req)
    if (
      !user ||
      !['owner', 'admin'].includes(user.teamRole) ||
      this.req.session?.bridgeAccessId
    )
      throw 'forbidden'
    const {
      app: resolvedApp,
      project,
      environment,
      actor
    } = await sails.helpers.bridge.resolveRequest.with({
      req: this.req,
      projectSlug: slug,
      environmentSlug: envSlug,
      appSlug,
      requireRunning: true
    })
    const app = await App.findOne({ id: resolvedApp.id }).decrypt()
    if (!app.bridgeEnabled || !app.bridgeSecret) throw 'forbidden'
    const attempt = await sails.getDatastore().sendNativeQuery(
      `INSERT INTO bridge_support_budgets(actor,window_start,requests) VALUES(?,?,1)
       ON CONFLICT(actor) DO UPDATE SET
       requests=CASE WHEN window_start<=excluded.window_start-60000 THEN 1 ELSE requests+1 END,
       window_start=CASE WHEN window_start<=excluded.window_start-60000 THEN excluded.window_start ELSE window_start END
       WHERE window_start<=excluded.window_start-60000 OR requests<5`,
      [user.id, Date.now()]
    )
    if (attempt.changes !== 1)
      throw {
        badRequest: {
          message: 'Too many support-view attempts. Wait a minute and retry.'
        }
      }
    try {
      await sails.helpers.passwords.checkPassword(
        password,
        (
          await User.findOne({ id: user.id })
        ).password
      )
    } catch {
      await AuditLog.create({
        action: 'bridge.impersonation.denied',
        user: user.id,
        team: project.team?.id || project.team,
        resourceType: 'app',
        resourceId: String(app.id),
        details: { subject: recordId, reason: 'reauthentication_failed' }
      })
      throw {
        badRequest: {
          message:
            'Confirm your current Slipway password to start a support view.'
        }
      }
    }
    const descriptor = await sails.helpers.bridge.supportDescriptor.with({
      containerName: app.containerName
    })
    const loaded = await sails.helpers.bridge.loadResource.with({
      containerName: app.containerName,
      environmentId: environment.id,
      modelIdentity,
      recordId,
      action: 'view',
      actor
    })
    modelIdentity = loaded.resource.identity
    if (!descriptor.enabled || descriptor.model !== modelIdentity)
      throw {
        badRequest: {
          message:
            'This app has not approved this identity model and its read-only support pages.'
        }
      }
    const appUrl = await sails.helpers.bridge.getAppUrl.with({
      app,
      environment,
      project
    })
    if (
      !appUrl ||
      (sails.config.environment !== 'test' && !appUrl.startsWith('https://'))
    )
      throw {
        badRequest: { message: 'Support views require an HTTPS app address.' }
      }
    const token = crypto.randomBytes(32).toString('hex')
    const grant = await require('../../lib/with-datastore-transaction')(
      async (db) => {
        const created = await BridgeSupportGrant.create({
          tokenHash: grants.hash(token),
          credentialHash: grants.hash(app.bridgeSecret),
          app: app.id,
          actor: user.id,
          scope: {
            actor: String(user.id),
            actorAuthVersion: user.authVersion || '',
            subject: recordId,
            model: modelIdentity,
            team: project.team?.id || project.team,
            environment: environment.id,
            project: project.id,
            reason: reason.trim(),
            mode: 'read-only',
            returnPath: `/projects/${encodeURIComponent(
              project.slug
            )}/environments/${encodeURIComponent(
              environment.slug
            )}/apps/${encodeURIComponent(app.slug)}/bridge/${encodeURIComponent(
              loaded.resource.slug || modelIdentity
            )}/${encodeURIComponent(recordId)}`,
            ip: String(this.req.ip || '').slice(0, 64),
            userAgent: String(this.req.headers['user-agent'] || '').slice(
              0,
              300
            )
          },
          expiresAt: Date.now() + 120000,
          endsAt: Date.now() + 15 * 60000
        })
          .usingConnection(db)
          .fetch()
        await grants.audit(created, 'requested', {}, db)
        return created
      }
    )
    return {
      url: `${appUrl.replace(
        /\/$/,
        ''
      )}/_slipway/bridge/impersonation/start#${token}`,
      grantId: grant.id
    }
  }
}
