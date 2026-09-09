const custom = require('../../../../lib/custom-service')
const routes = require('../../../../lib/custom-service-route')
module.exports = {
  friendlyName: 'Manage custom service public route',
  inputs: {
    serviceId: { type: 'string', required: true },
    action: {
      type: 'string',
      required: true,
      isIn: ['review', 'apply', 'recover']
    },
    domain: { type: 'string', defaultsTo: '', maxLength: 253 },
    port: { type: 'number' },
    reviewId: { type: 'string' }
  },
  exits: {
    success: { statusCode: 200 },
    notFound: { statusCode: 404 },
    forbidden: { statusCode: 403 },
    badRequest: { responseType: 'badRequest' }
  },
  fn: async function ({ serviceId, action, domain, port, reviewId }) {
    const service = await Service.findOne({ id: serviceId })
    if (service?.type !== 'custom' || service.managementMode === 'external')
      throw 'notFound'
    let actor
    try {
      actor = await custom.authorize(this.req, service.environment)
    } catch {
      throw 'forbidden'
    }
    try {
      if (action === 'review')
        return { review: await routes.review(service, actor, domain, port) }
      if (action === 'recover')
        return {
          service: Service.toPublic(await routes.recover(service, actor))
        }
      const review = await CustomServiceReview.findOne({
        token: reviewId || ''
      }).decrypt()
      if (
        !review ||
        review.imageMetadata?.purpose !== 'service-route' ||
        review.actor !== actor.user.id ||
        String(review.serviceId) !== String(service.id)
      )
        custom.fail('This review is unavailable. Review the route again.')
      return { service: Service.toPublic(await routes.apply(review, actor)) }
    } catch (error) {
      throw {
        badRequest: {
          message:
            error.code === 'CUSTOM_SERVICE' || error.code === 'DOMAIN_IN_USE'
              ? error.message
              : 'The route could not be changed. Refresh to check its state before retrying.'
        }
      }
    }
  }
}
