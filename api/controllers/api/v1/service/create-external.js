const connection = require('../../../../lib/external-postgresql')
module.exports = {
  friendlyName: 'Register external PostgreSQL',
  inputs: {
    projectSlug: { type: 'string', required: true },
    environmentSlug: { type: 'string', defaultsTo: 'production' },
    name: {
      type: 'string',
      required: true,
      maxLength: 60,
      regex: /^[a-z0-9-]+$/
    },
    configuration: { type: 'ref', required: true }
  },
  exits: {
    success: { statusCode: 201 },
    notFound: { statusCode: 404 },
    forbidden: { statusCode: 403 },
    badRequest: { responseType: 'badRequest' }
  },
  fn: async function ({ projectSlug, environmentSlug, name, configuration }) {
    const user = await User.forRequest(this.req)
    const project = await Project.findOne({ slug: projectSlug })
    if (!project) throw 'notFound'
    if (
      project.team !== user.team ||
      !['owner', 'admin'].includes(user.teamRole)
    )
      throw 'forbidden'
    const environment = await Environment.findOne({
      project: project.id,
      slug: environmentSlug
    }).decrypt()
    if (!environment) throw 'notFound'
    if (await Service.findOne({ environment: environment.id, name }))
      throw {
        badRequest: { message: 'A service with this name already exists.' }
      }
    let config
    try {
      config = connection.parse(configuration)
    } catch (error) {
      throw {
        badRequest: {
          message:
            error.code === 'EXTERNAL_CONFIGURATION'
              ? error.message
              : 'Enter a valid PostgreSQL connection URL.'
        }
      }
    }
    const current = environment.envVars || {}
    const key =
      current.DATABASE_URL === undefined
        ? 'DATABASE_URL'
        : `${name.replace(/-/g, '_').toUpperCase()}_URL`
    if (
      current[key] !== undefined ||
      (config.caCertificate && current[`${key}_CA_CERT`] !== undefined)
    )
      throw {
        badRequest: {
          message:
            'The connection variable is already in use. Choose another service name.'
        }
      }
    const additions = { [key]: connection.connectionUrl(config) }
    if (config.caCertificate) additions[`${key}_CA_CERT`] = config.caCertificate
    const values = { ...current, ...additions }
    const metadata =
      await sails.helpers.configuration.normalizeEnvVarMetadata.with({
        values,
        metadata: {
          ...(environment.envVarMetadata || {}),
          ...Object.fromEntries(
            Object.keys(additions).map((key) => [
              key,
              {
                kind: 'secret',
                managed: true,
                previewPolicy: 'omit',
                description: `Connection managed by ${name}`
              }
            ])
          )
        },
        currentValues: current,
        currentMetadata: environment.envVarMetadata || {},
        managedKeys: Object.keys(additions),
        changedBy: String(user.id),
        changedByName: user.fullName
      })
    const service = await sails.getDatastore().transaction(async (db) => {
      const service = await Service.create({
        name,
        type: 'postgresql',
        managementMode: 'external',
        version: 'external',
        status: 'unverified',
        externalVerification: { tlsMode: config.sslMode },
        externalConnection: config,
        internalHost: config.host,
        internalPort: config.port,
        envVarKey: key,
        environment: environment.id
      })
        .usingConnection(db)
        .fetch()
      await Environment.updateOne({ id: environment.id })
        .set({
          envVars: values,
          envVarMetadata: metadata
        })
        .usingConnection(db)
      await AuditLog.create({
        action: 'service.external.registered',
        resourceType: 'service',
        resourceId: String(service.id),
        details: { name, type: 'postgresql', tlsMode: config.sslMode },
        user: user.id,
        team: project.team,
        ipAddress: this.req.ip
      }).usingConnection(db)
      return service
    })
    return {
      service: {
        id: service.id,
        name,
        type: 'postgresql',
        managementMode: 'external',
        status: 'unverified',
        envVarKey: key
      }
    }
  }
}
