const crypto = require('node:crypto')
const path = require('node:path')
const fs = require('node:fs/promises')
const transaction = require('../../lib/with-datastore-transaction')

module.exports = {
  friendlyName: 'Run durable checks-only queue',
  fn: async function () {
    const now = Date.now()
    const stale = await CiJob.find({
      or: [
        { state: 'running', leaseExpires: { '<=': now } },
        { state: 'queued', deadline: { '<=': now } }
      ]
    }).limit(100)
    for (const job of stale) {
      const stopped = await CiJob.updateOne({
        id: job.id,
        state: job.state,
        leaseExpires: job.leaseExpires
      }).set({
        state: 'cancelled',
        reason: 'CI ownership or queue deadline expired. Request a new run.'
      })
      if (stopped?.run) {
        try {
          await sails.helpers.ci.cleanupJobContainer.with({ job: stopped })
          const receipt = await CiRun.findOne({ id: stopped.run })
          await CiRun.updateOne({ id: stopped.run, state: 'pending' }).set({
            state: 'failed',
            completedAt: Date.now(),
            summary: {
              ...receipt.summary,
              state: 'interrupted',
              reason: stopped.reason,
              cleanup: { state: 'completed' },
              finishedAt: Date.now()
            }
          })
        } catch {
          await CiJob.updateOne({ id: stopped.id }).set({
            reason:
              'CI ownership expired; container cleanup needs verification. Capacity remains blocked.'
          })
        }
      }
    }
    const queued = await CiJob.find({ state: 'queued', deadline: { '>': now } })
      .sort('createdAt ASC')
      .limit(20)
    for (const candidate of queued) {
      const claimed = await transaction(async (connection) => {
        const policy = await CiPolicy.updateOne({
          app: candidate.app,
          revision: candidate.policyRevision,
          enabled: true
        })
          .set({ revision: candidate.policyRevision })
          .usingConnection(connection)
        if (!policy || policy.configuration.pullRequests !== true) {
          await CiJob.updateOne({ id: candidate.id, state: 'queued' })
            .set({
              state: 'cancelled',
              reason: 'The reviewed CI policy changed.'
            })
            .usingConnection(connection)
          return null
        }
        if (
          await CiJob.count({
            state: 'running',
            leaseExpires: { '>': Date.now() }
          }).usingConnection(connection)
        )
          return null
        return CiJob.updateOne({
          id: candidate.id,
          state: 'queued',
          deadline: { '>': Date.now() }
        })
          .set({
            state: 'running',
            leaseToken: crypto.randomUUID(),
            leaseExpires: Date.now() + 30000
          })
          .usingConnection(connection)
      })
      if (claimed) {
        await run(claimed)
        break
      }
    }
    // Reporting retries are separate from execution and bounded to recent jobs.
    const jobs = await CiJob.find({ createdAt: { '>': now - 86400000 } })
      .sort('createdAt DESC')
      .limit(100)
    for (const job of jobs) {
      try {
        await sails.helpers.ci.publishJobStatus.with({ jobId: job.jobId })
      } catch (error) {
        sails.log.warn('CI GitHub reporting:', error.message)
      }
    }
  }
}

async function run(job) {
  const controller = new AbortController()
  let workspace,
    monitoring = false,
    lost
  const own = () =>
    sails.helpers.ci.assertJobLease.with({
      jobId: job.jobId,
      token: job.leaseToken,
      appId: String(job.app),
      policyRevision: job.policyRevision
    })
  const heartbeat = setInterval(async () => {
    if (monitoring) return
    monitoring = true
    try {
      await own()
    } catch (error) {
      lost = error
      controller.abort(error)
    } finally {
      monitoring = false
    }
  }, 10000)
  try {
    const app = await App.findOne({ id: job.app })
    const policy = await CiPolicy.findOne({ app: job.app })
    await own()
    const source = await sails.helpers.ci.resolvePullRequest.with({
      app,
      policy,
      pullRequest: job.pullRequest,
      expectedCommit: job.commit
    })
    const { repository } = await require('../../lib/ci-github').connection(app)
    await fs.mkdir(path.join(sails.config.appPath, '.tmp'), { recursive: true })
    workspace = await fs.mkdtemp(
      path.join(sails.config.appPath, '.tmp/ci-checkout-')
    )
    await fs.chmod(workspace, 0o700)
    await sails.helpers.git.cloneOrPull.with({
      cloneUrl: repository.cloneUrl,
      branch: source.branch,
      commit: source.commit,
      targetDir: path.join(workspace, 'source'),
      deployKeyPrivate: repository.deployKeyPrivate || undefined,
      signal: controller.signal
    })
    await own()
    const result = await sails.helpers.ci.runServerChecks.with({
      appId: String(job.app),
      contextPath: path.join(workspace, 'source'),
      policyRevision: job.policyRevision,
      jobId: job.jobId,
      leaseToken: job.leaseToken,
      signal: controller.signal
    })
    if (lost) throw lost
    if (result.busy) {
      await CiJob.updateOne({
        id: job.id,
        state: 'running',
        leaseToken: job.leaseToken
      }).set({ state: 'queued', leaseToken: null, leaseExpires: null })
      return
    }
    await own()
    await sails.helpers.ci.resolvePullRequest.with({
      app,
      policy,
      pullRequest: job.pullRequest,
      expectedCommit: job.commit
    })
    const completed = await CiJob.updateOne({
      id: job.id,
      state: 'running',
      leaseToken: job.leaseToken,
      leaseExpires: { '>': Date.now() }
    }).set({ state: 'passed', leaseToken: null, leaseExpires: null })
    if (!completed) throw new Error('Checks-only CI lost result ownership.')
  } catch (error) {
    const reason = sails.hooks.secrets?.text
      ? sails.hooks.secrets.text(String(error.message).slice(0, 1000))
      : 'Checks-only CI did not complete.'
    await CiJob.updateOne({
      id: job.id,
      state: 'running',
      leaseToken: job.leaseToken
    }).set({ state: 'failed', reason, leaseToken: null, leaseExpires: null })
  } finally {
    clearInterval(heartbeat)
    while (monitoring) await new Promise((resolve) => setTimeout(resolve, 10))
    if (workspace) await fs.rm(workspace, { recursive: true, force: true })
  }
}
