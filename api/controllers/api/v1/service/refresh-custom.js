const custom = require('../../../../lib/custom-service')
module.exports = {
  friendlyName: 'Refresh custom service state',
  inputs: { serviceId: { type: 'string', required: true } },
  exits: {
    success: { statusCode: 200 },
    notFound: { statusCode: 404 },
    forbidden: { statusCode: 403 },
    badRequest: { responseType: 'badRequest' }
  },
  fn: async function ({ serviceId }) {
    const service = await Service.findOne({ id: serviceId })
    if (service?.type !== 'custom') throw 'notFound'
    try {
      await custom.authorize(this.req, service.environment)
    } catch {
      throw 'forbidden'
    }
    try {
      if (['creating', 'changing'].includes(service.status))
        return { status: service.status, customState: service.customState }
      const claimed = await Service.updateOne({
        id: service.id,
        status: service.status
      }).set({ status: 'changing' })
      if (!claimed) custom.fail('Another operation started. Refresh and retry.')
      try {
        await custom.available(service.environment, undefined, service.id)
        return await custom.observe(service)
      } finally {
        await Service.updateOne({ id: service.id, status: 'changing' }).set({
          status: service.status
        })
      }
    } catch {
      throw {
        badRequest: {
          message:
            'Docker state could not be confirmed. Retry when Docker is available.'
        }
      }
    }
  }
}
