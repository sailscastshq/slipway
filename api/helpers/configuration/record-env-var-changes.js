module.exports = {
  friendlyName: 'Record environment variable changes',

  description:
    'Write one value-free audit event for every created, updated, rotated, or deleted variable.',

  inputs: {
    before: { type: 'ref', defaultsTo: {} },
    after: { type: 'ref', defaultsTo: {} },
    beforeMetadata: { type: 'ref', defaultsTo: {} },
    afterMetadata: { type: 'ref', defaultsTo: {} },
    scope: {
      type: 'string',
      required: true,
      isIn: ['global', 'environment', 'app']
    },
    resourceType: { type: 'string', required: true },
    resourceId: { type: 'string' },
    userId: { type: 'string' },
    teamId: { type: 'string' },
    ipAddress: { type: 'string' }
  },

  fn: async function ({
    before,
    after,
    beforeMetadata,
    afterMetadata,
    scope,
    resourceType,
    resourceId,
    userId,
    teamId,
    ipAddress
  }) {
    const changes = sails.helpers.configuration.diffEnvVars(
      before,
      after,
      beforeMetadata,
      afterMetadata
    )

    for (const change of changes) {
      await sails.helpers.audit.log.with({
        action: `configuration.${change.operation}`,
        resourceType,
        resourceId,
        details: { scope, ...change },
        userId,
        teamId,
        ipAddress
      })
    }

    return changes
  }
}
