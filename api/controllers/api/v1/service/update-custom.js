const custom = require('../../../../lib/custom-service')
const updates = require('../../../../lib/custom-service-update')
module.exports = {
  friendlyName: 'Review and update custom service',
  inputs: {
    serviceId: { type: 'string', required: true },
    action: {
      type: 'string',
      required: true,
      isIn: ['review', 'revert', 'apply', 'recover']
    },
    changes: { type: 'ref', defaultsTo: {} },
    reviewId: { type: 'string' }
  },
  exits: {
    success: { statusCode: 200 },
    notFound: { statusCode: 404 },
    forbidden: { statusCode: 403 },
    badRequest: { responseType: 'badRequest' }
  },
  fn: async function ({ serviceId, action, changes, reviewId }) {
    const service = await Service.findOne({ id: serviceId }).decrypt()
    if (service?.type !== 'custom' || service.managementMode === 'external')
      throw 'notFound'
    let actor
    try {
      actor = await custom.authorize(this.req, service.environment)
    } catch {
      throw 'forbidden'
    }
    try {
      await custom.available(service.environment, actor.project.id, service.id)
      if (action === 'review' || action === 'revert')
        return {
          review: await updates.review(
            service,
            actor,
            changes,
            action === 'revert'
          )
        }
      if (action === 'recover')
        return {
          service: Service.toPublic(await updates.recover(service, actor))
        }
      const item = await CustomServiceReview.findOne({
        token: reviewId || ''
      }).decrypt()
      if (
        !item ||
        item.imageMetadata?.purpose !== 'service-update' ||
        item.actor !== actor.user.id ||
        String(item.serviceId) !== String(service.id)
      )
        custom.fail('This review is unavailable. Review the update again.')
      return { service: Service.toPublic(await updates.apply(item, actor)) }
    } catch (error) {
      throw {
        badRequest: {
          message:
            error.code === 'CUSTOM_SERVICE'
              ? error.message
              : 'The update could not complete. Refresh to check recovery.'
        }
      }
    }
  }
}
