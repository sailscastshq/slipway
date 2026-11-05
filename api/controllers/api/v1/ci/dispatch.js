module.exports = {
  friendlyName: 'Local-first CI API',
  inputs: {
    slug: { type: 'string', required: true },
    envSlug: { type: 'string', defaultsTo: 'production' },
    appSlug: { type: 'string', required: true },
    operation: {
      type: 'string',
      isIn: [
        'policy',
        'approve-runner',
        'revoke-runner',
        'challenge',
        'receipt',
        'runs',
        'checks',
        'cancel-checks',
        'retry-report'
      ],
      required: true
    },
    commit: { type: 'string' },
    branch: { type: 'string' },
    image: { type: 'string' },
    platform: { type: 'string' },
    approvePolicy: { type: 'boolean' },
    enabled: { type: 'boolean' },
    automatic: { type: 'boolean' },
    pullRequests: { type: 'boolean' },
    pullRequest: { type: 'number' },
    requestId: { type: 'string' },
    jobId: { type: 'string' },
    approveRetry: { type: 'boolean' },
    confirmConnectionChanged: { type: 'boolean' },
    trustDevice: { type: 'boolean' },
    name: { type: 'string' },
    publicKey: { type: 'string' },
    policyRevision: { type: 'string' },
    runnerId: { type: 'string' },
    runId: { type: 'string' },
    report: { type: 'json' },
    signature: { type: 'string' }
  },
  exits: {
    success: {},
    invalid: { statusCode: 400 },
    forbidden: { statusCode: 403 }
  },
  fn: async function ({ slug, envSlug, appSlug, operation, ...data }) {
    try {
      return await sails.helpers.ci.handleRequest.with({
        req: this.req,
        target: { slug, envSlug, appSlug },
        operation,
        data
      })
    } catch (error) {
      if (
        error === 'forbidden' ||
        error.code === 'E_FORBIDDEN' ||
        error.code === 'forbidden' ||
        error.exit === 'forbidden'
      )
        throw 'forbidden'
      throw {
        invalid: {
          message: error.message || 'CI could not accept that request.'
        }
      }
    }
  }
}
