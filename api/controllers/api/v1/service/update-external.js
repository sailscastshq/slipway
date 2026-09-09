const connection = require('../../../../lib/external-postgresql')
module.exports = {
  friendlyName: 'Update external PostgreSQL connection',
  inputs: {
    serviceId: { type: 'string', required: true },
    configuration: { type: 'ref', required: true }
  },
  exits: {
    success: { statusCode: 200 },
    notFound: { statusCode: 404 },
    forbidden: { statusCode: 403 },
    badRequest: { responseType: 'badRequest' }
  },
  fn: async function ({ serviceId, configuration }) {
    const user = await User.forRequest(this.req)
    const service = await Service.findOne({ id: serviceId }).decrypt()
    if (!service || service.managementMode !== 'external') throw 'notFound'
    const environment = await Environment.findOne({
      id: service.environment
    }).decrypt()
    const project = await Project.findOne({ id: environment.project })
    if (
      project.team !== user.team ||
      !['owner', 'admin'].includes(user.teamRole)
    )
      throw 'forbidden'
    let config
    try {
      config = connection.parse({
        ...configuration,
        dsn:
          configuration.dsn ||
          connection.connectionUrl(service.externalConnection).split('?')[0],
        caCertificate:
          configuration.sslMode && configuration.sslMode !== 'verify-full'
            ? ''
            : configuration.caCertificate ||
              service.externalConnection.caCertificate
      })
    } catch (error) {
      throw {
        badRequest: {
          message:
            error.code === 'EXTERNAL_CONFIGURATION'
              ? error.message
              : 'Enter valid PostgreSQL connection settings.'
        }
      }
    }
    if (
      config.caCertificate &&
      !service.externalConnection.caCertificate &&
      environment.envVars?.[`${service.envVarKey}_CA_CERT`] !== undefined
    )
      throw {
        badRequest: {
          message:
            'The CA environment variable is already in use. Rename it before adding a managed CA.'
        }
      }
    const values = {
      ...environment.envVars,
      [service.envVarKey]: connection.connectionUrl(config)
    }
    if (config.caCertificate)
      values[`${service.envVarKey}_CA_CERT`] = config.caCertificate
    else delete values[`${service.envVarKey}_CA_CERT`]
    const metadata =
      await sails.helpers.configuration.normalizeEnvVarMetadata.with({
        values,
        metadata: environment.envVarMetadata || {},
        currentValues: environment.envVars || {},
        currentMetadata: environment.envVarMetadata || {},
        managedKeys: [
          service.envVarKey,
          ...(config.caCertificate ? [`${service.envVarKey}_CA_CERT`] : [])
        ],
        changedBy: String(user.id),
        changedByName: user.fullName
      })
    await sails.getDatastore().transaction(async (db) => {
      await Service.updateOne({ id: service.id })
        .set({
          externalConnection: config,
          status: 'unverified',
          externalVerification: {
            tlsMode: config.sslMode,
            ...(service.externalVerification?.cleanupContainer
              ? {
                  cleanupContainer:
                    service.externalVerification.cleanupContainer
                }
              : {})
          },
          internalHost: config.host,
          internalPort: config.port
        })
        .usingConnection(db)
      await Environment.updateOne({ id: environment.id })
        .set({ envVars: values, envVarMetadata: metadata })
        .usingConnection(db)
      await AuditLog.create({
        action: 'service.external.updated',
        resourceType: 'service',
        resourceId: String(service.id),
        user: user.id,
        team: project.team,
        details: { tlsMode: config.sslMode }
      }).usingConnection(db)
    })
    return {
      message:
        'Connection saved. Verify access and redeploy apps to use the new settings.'
    }
  }
}
