/** Bounded execution receipts, not a scheduler or a source of execution truth. */
module.exports = {
  datastore: 'observability',
  tableName: 'quest_runs',
  attributes: {
    runId: {
      type: 'string',
      required: true,
      unique: true,
      columnName: 'run_id'
    },
    requestKey: {
      type: 'string',
      allowNull: true,
      unique: true,
      columnName: 'request_key'
    },
    inputHash: { type: 'string', required: true, columnName: 'input_hash' },
    environment: { type: 'string', required: true },
    app: { type: 'string', required: true },
    deploymentId: {
      type: 'string',
      allowNull: true,
      columnName: 'deployment_id'
    },
    runtimeId: { type: 'string', allowNull: true, columnName: 'runtime_id' },
    jobName: { type: 'string', required: true, columnName: 'job_name' },
    actor: { type: 'json', defaultsTo: null },
    trigger: { type: 'string', defaultsTo: 'manual' },
    state: {
      type: 'string',
      isIn: [
        'requested',
        'running',
        'cancelling',
        'completed',
        'failed',
        'skipped',
        'cancelled',
        'timed_out',
        'interrupted',
        'unconfirmed'
      ],
      defaultsTo: 'requested'
    },
    sequence: { type: 'number', defaultsTo: 0 },
    requestedAt: { type: 'number', required: true, columnName: 'requested_at' },
    startedAt: { type: 'number', allowNull: true, columnName: 'started_at' },
    finishedAt: { type: 'number', allowNull: true, columnName: 'finished_at' },
    duration: { type: 'number', allowNull: true },
    exitCode: { type: 'number', allowNull: true, columnName: 'exit_code' },
    signal: { type: 'string', allowNull: true },
    inputs: { type: 'json', defaultsTo: {} },
    result: { type: 'json', defaultsTo: { status: 'unavailable' } },
    resultStatus: {
      type: 'string',
      defaultsTo: 'unavailable',
      columnName: 'result_status'
    },
    error: { type: 'string', allowNull: true },
    stdout: { type: 'string', defaultsTo: '' },
    stderr: { type: 'string', defaultsTo: '' },
    logsTruncated: {
      type: 'boolean',
      defaultsTo: false,
      columnName: 'logs_truncated'
    },
    logsAvailable: {
      type: 'boolean',
      defaultsTo: false,
      columnName: 'logs_available'
    }
  }
}
