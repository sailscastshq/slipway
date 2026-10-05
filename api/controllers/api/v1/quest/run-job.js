const workspace = require('../../../../lib/quest-workspace')
const runtime = require('../../../../lib/quest-runtime-client')
module.exports = {
  friendlyName: 'Run Quest job',
  description: 'Admit a named job in the verified resident Quest runtime.',
  inputs: {
    projectSlug: { type: 'string', required: true },
    environmentSlug: { type: 'string', defaultsTo: 'production' },
    name: { type: 'string', required: true },
    jobInputs: { type: 'ref', defaultsTo: {} },
    metadataVersion: { type: 'string', required: true },
    runtimeId: { type: 'string', required: true },
    requestId: { type: 'string', required: true },
    priorRunId: { type: 'string' },
    productionConfirmed: { type: 'boolean', defaultsTo: false }
  },
  exits: {
    success: { statusCode: 202 },
    notFound: { statusCode: 404 },
    forbidden: { statusCode: 403 },
    conflict: { statusCode: 409 },
    badRequest: { responseType: 'badRequest' }
  },
  fn: async function ({
    projectSlug,
    environmentSlug,
    name,
    jobInputs,
    metadataVersion,
    runtimeId,
    requestId,
    priorRunId,
    productionConfirmed
  }) {
    const context = await workspace.resolveContext(
      this.req,
      projectSlug,
      environmentSlug,
      true
    )
    if (
      (context.environment.isProduction ||
        context.environment.slug === 'production') &&
      productionConfirmed !== true
    )
      throw {
        badRequest: {
          message: 'Review and confirm this production job before running it.'
        }
      }
    const current = await workspace.snapshot(context)
    if (!current.capabilities.invoke || current.target.runtimeId !== runtimeId)
      throw {
        conflict: {
          message:
            'The resident runtime is unavailable or changed. Refresh and review the job.'
        }
      }
    if (
      !current.jobs.some(
        (job) => job.name === name && job.metadataVersion === metadataVersion
      )
    )
      throw {
        conflict: { message: 'Job inputs changed. Review the current job.' }
      }
    if (priorRunId) {
      const prior = await require('../../../../lib/quest-run-ledger').getRun(
        { environmentId: context.environment.id, appId: context.app.id },
        priorRunId
      )
      if (!prior || prior.jobName !== name) throw 'notFound'
    }
    let accepted
    try {
      accepted = await runtime.request(context.app, 'invoke', {
        name,
        jobInputs,
        metadataVersion,
        runtimeId,
        requestId,
        actor: context.user.fullName
      })
    } catch (error) {
      const conflict = [
        'QUEST_TARGET_CHANGED',
        'QUEST_PAUSED',
        'QUEST_ALREADY_RUNNING',
        'QUEST_UNCONFIRMED'
      ].includes(error.code)
      throw {
        [conflict ? 'conflict' : 'badRequest']: {
          message: error.message,
          code: error.code || 'QUEST_UNCONFIRMED'
        }
      }
    }
    // If persistence fails after admission, the canonical resident identity is
    // still returned. A browser retry must keep the same invocation key.
    try {
      const detail = await runtime.request(context.app, 'run', {
        runtimeId,
        runId: accepted.run.runId
      })
      await workspace.synchronizeRun(context, detail.run)
    } catch (error) {
      sails.log.warn(
        '[quest] Accepted run persistence pending:',
        error.code || error.name
      )
    }
    await sails.helpers.audit.log.with({
      action: 'quest.run.admitted',
      resourceType: 'app',
      resourceId: String(context.app.id),
      userId: String(context.user.id),
      teamId: String(context.user.team),
      ipAddress: this.req.ip,
      details: {
        jobName: name,
        runId: accepted.run.runId,
        runtimeId,
        deploymentId: String(context.app.currentDeployment),
        metadataVersion,
        priorRunId: priorRunId || null
      }
    })
    workspace.invalidate(context.app)
    return accepted
  }
}
