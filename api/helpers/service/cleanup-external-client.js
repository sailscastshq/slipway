const removeClient = require('../../lib/remove-external-client')
module.exports = {
  friendlyName: 'Clean up an external database client',
  inputs: { serviceId: { type: 'string', required: true } },
  fn: async function ({ serviceId }) {
    const service = await Service.findOne({ id: serviceId })
    const name = service?.externalVerification?.cleanupContainer
    if (!name) return
    if (!/^slipway-pg-client-[a-f0-9-]{36}$/.test(name))
      throw new Error('Invalid external client cleanup reference.')
    try {
      await removeClient(sails.config.docker?.binaryPath || 'docker', name)
    } catch {
      throw new Error(
        'External client cleanup could not be confirmed. Check Docker and retry verification.'
      )
    }
    const { cleanupContainer, ...verification } = service.externalVerification
    await Service.updateOne({ id: serviceId }).set({
      externalVerification: verification
    })
  }
}
