module.exports = {
  friendlyName: 'Reveal configuration secret',
  description:
    'Explicitly reveal one authorized value after a durable value-free audit.',
  inputs: {
    scope: {
      type: 'string',
      required: true,
      isIn: ['app', 'environment', 'service', 'global']
    },
    id: { type: 'string', required: true, maxLength: 80 },
    key: { type: 'string', required: true, maxLength: 160 }
  },
  exits: {
    success: { statusCode: 200 },
    notFound: { statusCode: 404 },
    forbidden: { statusCode: 403 },
    unavailable: { statusCode: 503 }
  },
  fn: async function ({ scope, id, key }) {
    this.res.set('Cache-Control', 'private, no-store')
    const user = await User.forRequest(this.req)
    if (!user || !['owner', 'admin'].includes(user.teamRole)) throw 'forbidden'
    let record
    if (scope === 'global') {
      const founder = await User.findOne({ id: user.id }).select([
        'isGenesisUser'
      ])
      if (!founder?.isGenesisUser || id !== 'global') throw 'forbidden'
    } else {
      const model = { app: App, environment: Environment, service: Service }[
        scope
      ]
      record = await model.findOne({ id })
      if (!record) throw 'notFound'
      const environment =
        scope === 'environment'
          ? record
          : await Environment.findOne({ id: record.environment })
      const project =
        environment &&
        (await Project.findOne({ id: environment.project, team: user.team }))
      if (!project) throw 'notFound'
      record = await model.findOne({ id }).decrypt()
    }
    sails.hooks.secrets?.remember(record)
    let value
    if (scope === 'service') {
      if (key !== 'connectionUrl') throw 'notFound'
      value = await Service.getConnectionUrl(record.id)
    } else {
      const values =
        scope === 'global'
          ? JSON.parse(await sails.helpers.setting.get('globalEnvVars', '{}'))
          : scope === 'app'
          ? record.secureEnvVars || record.envVars || {}
          : record.envVars || {}
      if (!Object.hasOwn(values, key)) throw 'notFound'
      value = values[key]
    }
    // Fail closed if the audit cannot be persisted; the normal audit helper is
    // intentionally best-effort for other operations and is unsuitable here.
    try {
      await AuditLog.create({
        action: 'configuration.revealed',
        resourceType: scope === 'global' ? 'setting' : scope,
        resourceId: scope === 'global' ? 'globalEnvVars' : id,
        details: { key },
        user: user.id,
        team: user.team,
        ipAddress: this.req.ip
      })
    } catch {
      throw 'unavailable'
    }
    return { value }
  }
}
