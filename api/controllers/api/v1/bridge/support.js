const grants = require('../../../../lib/bridge-support-grants')
const transaction = require('../../../../lib/with-datastore-transaction')
module.exports = {
  friendlyName: 'Exchange and audit host support sessions',
  inputs: {
    appId: { type: 'string', required: true },
    action: {
      type: 'string',
      required: true,
      isIn: ['exchange', 'status', 'event']
    },
    code: { type: 'string', maxLength: 64 },
    nonce: { type: 'string', maxLength: 64 },
    grantId: { type: 'string' },
    eventId: { type: 'string', maxLength: 32 },
    occurredAt: { type: 'number' },
    event: {
      type: 'string',
      isIn: ['started', 'denied', 'write_blocked', 'stopped', 'expired']
    }
  },
  exits: {
    success: { statusCode: 200 },
    unauthorized: { statusCode: 401 },
    forbidden: { statusCode: 403 }
  },
  fn: async function ({
    appId,
    action,
    code,
    nonce,
    grantId,
    event,
    eventId,
    occurredAt
  }) {
    let app
    try {
      app = await grants.authenticate(this.req, appId)
    } catch {
      throw 'unauthorized'
    }
    await grants.expire(app)
    this.res.set('Cache-Control', 'no-store')
    if (action === 'status')
      return {
        active: (
          await BridgeSupportGrant.find({
            app: app.id,
            status: 'active',
            endsAt: { '>': Date.now() }
          })
        ).map((g) => String(g.id))
      }
    if (action === 'exchange') {
      if (
        !/^[a-f0-9]{64}$/.test(code || '') ||
        !/^[a-f0-9]{64}$/.test(nonce || '')
      )
        throw 'forbidden'
      const grant = await transaction(async (db) => {
        const used = await BridgeSupportGrant.updateOne({
          tokenHash: grants.hash(code),
          app: app.id,
          credentialHash: grants.hash(app.bridgeSecret),
          status: 'issued',
          expiresAt: { '>': Date.now() }
        })
          .set({ status: 'active', consumedAt: Date.now() })
          .usingConnection(db)
        if (!used) return null
        return used
      })
      if (!grant) throw 'forbidden'
      const domain = await sails.helpers.setting.get('instanceDomain')
      const baseUrl = domain ? `https://${domain}` : sails.config.custom.baseUrl
      return {
        grant: {
          ...grant.scope,
          returnUrl: new URL(grant.scope.returnPath, baseUrl).href,
          appId: String(app.id),
          id: String(grant.id),
          expiresAt: grant.endsAt,
          nonce
        }
      }
    }
    const grant = await BridgeSupportGrant.findOne({ id: grantId, app: app.id })
    if (
      !grant ||
      !event ||
      !/^[a-f0-9]{32}$/.test(eventId || '') ||
      !Number.isFinite(occurredAt) ||
      occurredAt < grant.createdAt - 30000 ||
      occurredAt > Date.now() + 30000
    )
      throw 'forbidden'
    await transaction(async (db) => {
      const existing = await BridgeSupportEvent.findOne({
        eventId
      }).usingConnection(db)
      if (existing) {
        if (existing.grant !== grant.id || existing.action !== event)
          throw 'forbidden'
        return
      }
      await BridgeSupportEvent.create({
        eventId,
        grant: grant.id,
        action: event
      }).usingConnection(db)
      if (['denied', 'stopped', 'expired'].includes(event))
        await BridgeSupportGrant.updateOne({ id: grant.id, status: 'active' })
          .set({ status: event })
          .usingConnection(db)
      await grants.audit(grant, event, { occurredAt, eventId }, db)
    })
    return { accepted: true }
  }
}
