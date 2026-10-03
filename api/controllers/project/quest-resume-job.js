const workspace = require('../../lib/quest-workspace')
const runtime = require('../../lib/quest-runtime-client')
module.exports = {
  friendlyName: 'Quest resume job',
  inputs: {
    slug: { type: 'string', required: true },
    envSlug: { type: 'string', defaultsTo: 'production' },
    jobName: { type: 'string', required: true },
    runtimeId: { type: 'string', required: true }
  },
  exits: {
    success: { statusCode: 200 },
    notFound: { statusCode: 404 },
    forbidden: { statusCode: 403 },
    conflict: { statusCode: 409 }
  },
  fn: async function ({ slug, envSlug, jobName, runtimeId }) {
    const context = await workspace.resolveContext(
      this.req,
      slug,
      envSlug,
      true
    )
    const current = await workspace.snapshot(context)
    if (!current.capabilities.resume || current.target.runtimeId !== runtimeId)
      throw {
        conflict: {
          message: 'Resident Quest control is unavailable. Refresh this page.'
        }
      }
    try {
      await runtime.request(context.app, 'resume', { name: jobName, runtimeId })
    } catch (error) {
      throw { conflict: { message: error.message } }
    }
    await sails.helpers.audit.log.with({
      action: 'quest.job.resume',
      resourceType: 'app',
      resourceId: String(context.app.id),
      userId: String(context.user.id),
      teamId: String(context.user.team),
      ipAddress: this.req.ip,
      details: {
        jobName,
        runtimeId,
        deploymentId: String(context.app.currentDeployment)
      }
    })
    workspace.invalidate(context.app)
    return { workspace: await workspace.snapshot(context, { fresh: true }) }
  }
}
