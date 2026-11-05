module.exports = {
  tableName: 'ci_jobs',
  attributes: {
    jobId: {
      type: 'string',
      required: true,
      unique: true,
      columnName: 'job_id'
    },
    app: { model: 'app', required: true },
    pullRequest: { type: 'number', required: true, columnName: 'pull_request' },
    branch: { type: 'string', required: true },
    commit: { type: 'string', required: true },
    policyRevision: {
      type: 'string',
      required: true,
      columnName: 'policy_revision'
    },
    dedupeKey: {
      type: 'string',
      required: true,
      unique: true,
      columnName: 'dedupe_key'
    },
    state: {
      type: 'string',
      isIn: ['queued', 'running', 'passed', 'failed', 'cancelled'],
      defaultsTo: 'queued'
    },
    leaseToken: { type: 'string', allowNull: true, columnName: 'lease_token' },
    leaseExpires: {
      type: 'number',
      allowNull: true,
      columnName: 'lease_expires'
    },
    deadline: { type: 'number', required: true },
    run: { model: 'cirun' },
    reason: { type: 'string', allowNull: true },
    githubStatus: { type: 'json', defaultsTo: {}, columnName: 'github_status' }
  }
}
