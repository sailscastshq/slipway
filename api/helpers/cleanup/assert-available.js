module.exports = {
  friendlyName: 'Assert resource is available',

  description:
    'Prevent new work from racing a pending destructive cleanup operation.',

  inputs: {
    projectId: { type: 'number' },
    environmentId: { type: 'number' },
    appId: { type: 'number' },
    serviceId: { type: 'number' }
  },

  exits: {
    success: {},
    blocked: {
      outputType: 'ref'
    }
  },

  fn: async function ({ projectId, environmentId, appId, serviceId }) {
    const scopes = [
      projectId ? { scopeType: 'project', projectId } : null,
      environmentId ? { scopeType: 'environment', environmentId } : null,
      appId ? { scopeType: 'app', appId } : null,
      serviceId ? { scopeType: 'service', serviceId } : null
    ].filter(Boolean)

    if (scopes.length === 0) return

    const operation = await CleanupOperation.findOne({
      status: { nin: ['complete'] },
      or: scopes
    })
    if (!operation) return

    throw {
      blocked: {
        code: 'cleanupInProgress',
        message: `Cleanup operation ${operation.id} is ${operation.status}. Resume or complete it before starting new work.`,
        cleanupOperationId: operation.id
      }
    }
  }
}
