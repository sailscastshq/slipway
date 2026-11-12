module.exports = (job) => ({
  id: job.jobId,
  jobId: job.jobId,
  title: 'Pull request source checks',
  origin: 'server',
  state: job.state,
  sourceRevision: job.commit,
  pullRequest: job.pullRequest,
  branch: job.branch,
  scope: 'source-checks-only',
  deployable: false,
  accepted: false,
  steps: [],
  reason: job.reason,
  githubStatus: job.githubStatus,
  startedAt: job.createdAt
})
