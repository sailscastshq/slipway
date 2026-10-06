const workspace = require('../../../../lib/quest-workspace')
const runtime = require('../../../../lib/quest-runtime-client')
const ledger = require('../../../../lib/quest-run-ledger')
module.exports = {
  friendlyName: 'Request Quest cancellation',
  inputs: {
    projectSlug: { type: 'string', required: true },
    environmentSlug: { type: 'string', defaultsTo: 'production' },
    runId: { type: 'string', required: true },
    runtimeId: { type: 'string', required: true }
  },
  exits: {
    success: { statusCode: 202 },
    notFound: { statusCode: 404 },
    forbidden: { statusCode: 403 },
    conflict: { statusCode: 409 }
  },
  fn: async function (inputs) {
    const context = await workspace.resolveContext(
      this.req,
      inputs.projectSlug,
      inputs.environmentSlug,
      true
    )
    const run = await ledger.getRun(
      { environmentId: context.environment.id, appId: context.app.id },
      inputs.runId
    )
    if (!run) throw 'notFound'
    const current = await workspace.snapshot(context)
    if (
      !current.capabilities.cancel ||
      current.target.runtimeId !== inputs.runtimeId ||
      run.runtimeId !== inputs.runtimeId ||
      run.deploymentId !== String(context.app.currentDeployment)
    )
      throw {
        conflict: {
          message:
            'The owning runtime changed or does not support cancellation. Refresh this run.'
        }
      }
    let accepted
    try {
      accepted = await runtime.request(context.app, 'cancel', {
        runId: run.runId,
        runtimeId: inputs.runtimeId
      })
    } catch (error) {
      throw {
        conflict: {
          message: error.message,
          code: error.code || 'QUEST_UNCONFIRMED'
        }
      }
    }
    await sails.helpers.audit.log.with({
      action: 'quest.run.cancel.requested',
      resourceType: 'app',
      resourceId: String(context.app.id),
      userId: String(context.user.id),
      teamId: String(context.user.team),
      ipAddress: this.req.ip,
      details: {
        runId: run.runId,
        runtimeId: inputs.runtimeId,
        deploymentId: run.deploymentId
      }
    })
    workspace.invalidate(context.app)
    return accepted
  }
}
