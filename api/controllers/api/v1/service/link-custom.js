const custom = require('../../../../lib/custom-service')
module.exports = {
  friendlyName: 'Link custom service apps',
  inputs: {
    serviceId: { type: 'string', required: true },
    appIds: { type: 'ref', required: true }
  },
  exits: {
    success: { statusCode: 200 },
    notFound: { statusCode: 404 },
    forbidden: { statusCode: 403 },
    badRequest: { responseType: 'badRequest' }
  },
  fn: async function ({ serviceId, appIds }) {
    const service = await Service.findOne({ id: serviceId })
    if (service?.type !== 'custom') throw 'notFound'
    let actor
    try {
      actor = await custom.authorize(this.req, service.environment)
    } catch {
      throw 'forbidden'
    }
    try {
      if (
        !Array.isArray(appIds) ||
        appIds.length > 50 ||
        appIds.some((id) => !/^\d+$/.test(String(id)))
      )
        custom.fail('Choose valid apps in this environment.')
      if (
        service.customState?.update ||
        service.publicRoute?.operation ||
        ['creating', 'changing'].includes(service.status)
      )
        custom.fail('Wait for the active service operation.')
      await require('../../../../lib/with-datastore-transaction')(
        async (db) => {
          await custom.available(
            service.environment,
            actor.project.id,
            service.id,
            db
          )
          const current = await Service.findOne({
            id: service.id
          }).usingConnection(db)
          if (
            !current ||
            current.customState?.update ||
            current.publicRoute?.operation ||
            ['creating', 'changing'].includes(current.status)
          )
            custom.fail('Wait for the active service operation.')
          await custom.links(current, appIds, db)
          await AuditLog.create({
            action: 'service.custom.linked',
            resourceType: 'service',
            resourceId: String(service.id),
            user: actor.user.id,
            team: actor.project.team,
            details: { appIds }
          }).usingConnection(db)
        }
      )
      return {
        message:
          'Connections saved. Redeploy the affected apps to apply the change.'
      }
    } catch (e) {
      throw {
        badRequest: {
          message:
            e.code === 'CUSTOM_SERVICE'
              ? e.message
              : 'App connections could not be saved.'
        }
      }
    }
  }
}
