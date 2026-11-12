// One external writer per app/commit. Expired writers are quarantined rather
// than stolen: GitHub statuses do not offer a conditional/fenced write API.
module.exports = {
  tableName: 'ci_reports',
  attributes: {
    reportKey: {
      type: 'string',
      required: true,
      unique: true,
      columnName: 'report_key'
    },
    app: { model: 'app', required: true },
    commit: { type: 'string', required: true },
    leaseToken: { type: 'string', defaultsTo: '', columnName: 'lease_token' },
    leaseExpires: {
      type: 'number',
      defaultsTo: 0,
      columnName: 'lease_expires'
    },
    uncertain: { type: 'boolean', defaultsTo: false },
    deniedStatus: {
      type: 'number',
      defaultsTo: 0,
      columnName: 'denied_status'
    },
    lastJobId: { type: 'string', defaultsTo: '', columnName: 'last_job_id' },
    lastResponseId: {
      type: 'string',
      defaultsTo: '',
      columnName: 'last_response_id'
    }
  }
}
