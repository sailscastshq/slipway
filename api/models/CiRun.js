module.exports = {
  tableName: 'ci_runs',
  attributes: {
    runId: {
      type: 'string',
      required: true,
      unique: true,
      columnName: 'run_id'
    },
    app: {
      model: 'app',
      required: true
    },
    runner: {
      model: 'cirunner',
      required: true
    },
    policyRevision: {
      type: 'string',
      required: true,
      columnName: 'policy_revision'
    },
    commit: {
      type: 'string',
      required: true
    },
    challenge: {
      type: 'json',
      required: true
    },
    expiresAt: {
      type: 'number',
      required: true,
      columnName: 'expires_at'
    },
    state: {
      type: 'string',
      isIn: ['pending', 'passed', 'failed'],
      defaultsTo: 'pending'
    },
    receiptHash: {
      type: 'string',
      allowNull: true,
      columnName: 'receipt_hash'
    },
    summary: {
      type: 'json',
      defaultsTo: {}
    },
    completedAt: {
      type: 'number',
      allowNull: true,
      columnName: 'completed_at'
    }
  }
}
