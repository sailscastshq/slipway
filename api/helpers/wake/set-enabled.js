const crypto = require('node:crypto')
module.exports = {
  friendlyName: 'Set Wake availability',
  description:
    'Internal foundation helper; no user-facing enablement until collection is complete.',
  inputs: {
    req: { type: 'ref', required: true },
    projectSlug: { type: 'string', required: true },
    envSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true },
    enabled: { type: 'boolean', required: true }
  },
  exits: { forbidden: {}, notFound: {}, unavailable: {} },
  fn: async function ({ req, projectSlug, envSlug, appSlug, enabled }) {
    if (!req.session?.userId && !req.auth?.userId) throw 'forbidden'
    let resolved
    try {
      resolved = await sails.helpers.bearing.resolveManager.with({
        req,
        projectSlug,
        environmentSlug: envSlug,
        appSlug
      })
    } catch (error) {
      if (error.code === 'forbidden') throw 'forbidden'
      if (error.code === 'notFound') throw 'notFound'
      throw error
    }
    const { app, user } = resolved
    if (enabled && !sails.wakeStorageReady) throw 'unavailable'
    const secret = enabled
      ? `swk_${crypto.randomBytes(32).toString('hex')}`
      : null
    await App.updateOne({ id: app.id }).set({
      wakeEnabled: enabled,
      wakeSecret: secret
    })
    await sails.helpers.audit.log.with({
      action: 'wake.settings.updated',
      resourceType: 'app',
      resourceId: String(app.id),
      userId: String(user.id),
      teamId: String(user.team),
      ipAddress: req.ip,
      details: { enabled }
    })
    return { enabled, requiresRedeploy: enabled }
  }
}
