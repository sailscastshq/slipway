const contract = require('../../lib/external-postgresql')
module.exports = {
  friendlyName: 'Verify external PostgreSQL connection',
  inputs: { serviceId: { type: 'string', required: true } },
  fn: async function ({ serviceId }) {
    const service = await Service.findOne({ id: serviceId }).decrypt()
    if (service?.managementMode !== 'external')
      throw contract.normalize({ code: 'EXTERNAL_CONFIGURATION' })
    let verification
    try {
      const result = await sails.helpers.service.runExternalClient.with({
        serviceId,
        operation: 'verify',
        timeoutMs: 30000
      })
      const observed = JSON.parse(result.stdout.trim())
      if (
        !Number.isInteger(observed.version) ||
        observed.version < 140000 ||
        observed.version >= 180000
      )
        throw { code: 'EXTERNAL_VERSION', message: 'server version mismatch' }
      if (observed.canDump !== true)
        throw { code: 'EXTERNAL_PERMISSION', message: 'permission denied' }
      verification = {
        connectionFingerprint: require('node:crypto')
          .createHmac('sha256', sails.config.models.dataEncryptionKeys.default)
          .update(contract.connectionUrl(service.externalConnection))
          .digest('hex'),
        verifiedAt: Date.now(),
        status: 'reachable',
        tlsMode: service.externalConnection.sslMode,
        serverVersion: observed.version,
        message:
          'Connection and read permissions verified. A successful backup confirms dump access.'
      }
    } catch (error) {
      const safe = contract.normalize(error)
      verification = {
        verifiedAt: Date.now(),
        status: 'unreachable',
        tlsMode: service.externalConnection.sslMode,
        code: safe.code,
        message: safe.message
      }
    }
    const current = await Service.findOne({ id: serviceId }).decrypt()
    if (
      JSON.stringify(current.externalConnection) !==
      JSON.stringify(service.externalConnection)
    )
      return {
        status: 'unverified',
        message: 'The connection changed during verification. Verify again.'
      }
    verification = {
      ...(current.externalVerification?.cleanupContainer
        ? { cleanupContainer: current.externalVerification.cleanupContainer }
        : {}),
      ...verification
    }
    await Service.updateOne({ id: serviceId }).set({
      status: verification.status,
      externalVerification: verification
    })
    return verification
  }
}
