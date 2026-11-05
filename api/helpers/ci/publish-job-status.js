const crypto = require('node:crypto')
const github = require('../../lib/ci-github')
const transaction = require('../../lib/with-datastore-transaction')
const latest = (app, commit) =>
  CiJob.find({ app, commit })
    .sort(['createdAt DESC', 'id DESC'])
    .limit(1)
    .then((rows) => rows[0])
module.exports = {
  friendlyName: 'Publish checks-only GitHub status',
  inputs: { jobId: { type: 'string', required: true } },
  fn: async function ({ jobId }) {
    const initial = await CiJob.findOne({ jobId })
    if (
      !initial ||
      (await latest(initial.app, initial.commit))?.id !== initial.id
    )
      return
    if (
      initial.githubStatus?.published === true &&
      (initial.githubStatus.state !== 'pending' ||
        ['queued', 'running'].includes(initial.state))
    )
      return
    const app = await App.findOne({ id: initial.app })
    const authority = await github.connection(app)
    const denied = await CiReport.find({
      app: app.id,
      deniedStatus: [401, 403]
    }).limit(1)
    if (denied.length) {
      await CiJob.updateOne({ id: initial.id }).set({
        githubStatus: {
          published: false,
          denied: true,
          status: denied[0].deniedStatus,
          error: `GitHub refused commit-status reporting (HTTP ${denied[0].deniedStatus}). Repair the existing connection and explicitly request one reporting retry.`
        }
      })
      return
    }
    const key = crypto
      .createHash('sha256')
      .update(JSON.stringify([String(app.id), initial.commit]))
      .digest('hex')
    const token = crypto.randomUUID()
    const lease = await transaction(async (connection) => {
      const policy = await CiPolicy.findOne({ app: app.id }).usingConnection(
        connection
      )
      if (
        !policy ||
        String(authority.repository.externalId) !== String(policy.repositoryId)
      )
        throw new Error('CI repository changed before reporting.')
      // Take the same policy row lock as queue admission, without retaining it
      // across network I/O. A reporting lease serializes the external writes.
      await CiPolicy.updateOne({ id: policy.id, revision: policy.revision })
        .set({ revision: policy.revision })
        .usingConnection(connection)
      let row = await CiReport.findOne({ reportKey: key }).usingConnection(
        connection
      )
      if (!row)
        row = await CiReport.create({
          reportKey: key,
          app: app.id,
          commit: initial.commit
        })
          .fetch()
          .usingConnection(connection)
      if (row.uncertain || row.leaseToken) {
        if (row.leaseToken && row.leaseExpires <= Date.now())
          await CiReport.updateOne({ id: row.id, leaseToken: row.leaseToken })
            .set({ uncertain: true })
            .usingConnection(connection)
        return null
      }
      return CiReport.updateOne({
        id: row.id,
        leaseToken: '',
        uncertain: false
      })
        .set({ leaseToken: token, leaseExpires: Date.now() + 45000 })
        .usingConnection(connection)
    })
    if (!lease) {
      const row = await CiReport.findOne({ reportKey: key })
      if (row?.uncertain) {
        await CiJob.updateOne({ id: initial.id }).set({
          githubStatus: {
            published: false,
            error:
              'GitHub reporting paused after an interrupted or uncertain write. Verify the commit status before resuming reporting.'
          }
        })
        throw new Error(
          'GitHub CI reporting ownership is uncertain; no replacement writer was started.'
        )
      }
      return
    }
    let inFlight = false,
      uncertain = false,
      current = initial
    try {
      // If a new same-SHA rerun arrives during an old POST, publish its pending
      // or completed state after that response, before another writer can post.
      for (let count = 0; count < 3; count++) {
        current = await latest(app.id, initial.commit)
        if (!current) break
        const state = await statusFor(current, app)
        if (
          current.githubStatus?.published === true &&
          (current.githubStatus.state === state ||
            (current.githubStatus.state !== 'pending' &&
              !['queued', 'running'].includes(current.state)))
        )
          break
        const owned = await CiReport.updateOne({
          id: lease.id,
          leaseToken: token,
          uncertain: false,
          leaseExpires: { '>': Date.now() }
        }).set({ leaseExpires: Date.now() + 45000 })
        if (!owned)
          throw new Error(
            'GitHub reporting lease expired; no external write started.'
          )
        const metadata = await authority.request('')
        const policy = await CiPolicy.findOne({ app: app.id })
        if (
          String(metadata.id) !== String(authority.repository.externalId) ||
          String(metadata.id) !== String(policy?.repositoryId)
        )
          throw new Error(
            'GitHub repository identity changed before reporting.'
          )
        const body = statusBody(state, current, app, authority)
        inFlight = true
        const response = await authority.request(
          '/statuses/' + current.commit,
          { method: 'POST', body }
        )
        inFlight = false
        if (!Number.isSafeInteger(response.id) || response.id < 1) {
          uncertain = true
          throw new Error('GitHub did not return a status receipt.')
        }
        await transaction(async (connection) => {
          const saved = await CiReport.updateOne({
            id: lease.id,
            leaseToken: token,
            uncertain: false
          })
            .set({
              lastJobId: current.jobId,
              lastResponseId: String(response.id)
            })
            .usingConnection(connection)
          if (!saved)
            throw new Error(
              'GitHub status was sent but its reporting lease needs reconciliation.'
            )
          await CiJob.updateOne({ id: current.id })
            .set({
              githubStatus: {
                state,
                published: true,
                responseId: response.id,
                checkedAt: Date.now()
              }
            })
            .usingConnection(connection)
        })
        if ((await latest(app.id, initial.commit))?.id === current.id) break
      }
    } catch (error) {
      const denied = [401, 403].includes(error.status)
      uncertain ||=
        inFlight &&
        !(error.status >= 400 && error.status < 500 && error.status !== 408)
      if (denied)
        await CiReport.updateOne({ id: lease.id, leaseToken: token }).set({
          deniedStatus: error.status
        })
      if (uncertain)
        await CiReport.updateOne({ id: lease.id, leaseToken: token }).set({
          uncertain: true
        })
      await CiJob.updateOne({ id: current.id }).set({
        githubStatus: {
          published: false,
          ...(denied ? { denied: true, status: error.status } : {}),
          checkedAt: Date.now(),
          error: uncertain
            ? 'GitHub status outcome is uncertain; reporting is paused for reconciliation.'
            : error.message
        }
      })
      throw error
    } finally {
      if (!uncertain)
        await CiReport.updateOne({
          id: lease.id,
          leaseToken: token,
          uncertain: false
        }).set({ leaseToken: '', leaseExpires: 0 })
    }
  }
}
async function statusFor(job, app) {
  const policy = await CiPolicy.findOne({ app: app.id })
  if (
    !policy?.enabled ||
    policy.revision !== job.policyRevision ||
    policy.configuration?.pullRequests !== true
  )
    return 'error'
  if (['queued', 'running'].includes(job.state)) return 'pending'
  if (job.state !== 'passed')
    return job.state === 'failed' ? 'failure' : 'error'
  const run = job.run && (await CiRun.findOne({ id: job.run, app: app.id }))
  if (
    !run ||
    run.commit !== job.commit ||
    run.challenge?.jobId !== job.jobId ||
    !sails.helpers.ci.isServerEvidence.with({ run, policy, checksOnly: true })
  )
    return 'error'
  try {
    await sails.helpers.ci.resolvePullRequest.with({
      app,
      policy,
      pullRequest: job.pullRequest,
      expectedCommit: job.commit
    })
  } catch {
    return 'error'
  }
  return 'success'
}
function statusBody(state, job, app, { project, environment }) {
  const body = {
    state,
    context: `Slipway CI / ${app.slug}`.slice(0, 100),
    description: {
      pending: 'Source checks queued or running. No deployment started.',
      success: 'Install, lint, tests and build passed. Source checks only.',
      failure: 'Source checks failed. Inspect the Slipway CI run.',
      error: 'Source result is unavailable, interrupted or no longer current.'
    }[state]
  }
  const base = new URL(sails.config.custom.baseUrl)
  if (base.protocol === 'https:' && !base.username && !base.password) {
    base.pathname = `/projects/${encodeURIComponent(
      project.slug
    )}/environments/${encodeURIComponent(
      environment.slug
    )}/apps/${encodeURIComponent(app.slug)}/ci`
    base.search = ''
    body.target_url = base.href
  }
  return body
}
