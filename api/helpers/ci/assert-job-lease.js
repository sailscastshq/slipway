module.exports = {
  friendlyName: 'Assert checks-only job ownership',
  inputs: {
    jobId: { type: 'string', required: true },
    token: { type: 'string', required: true },
    appId: { type: 'string', required: true },
    policyRevision: { type: 'string', required: true }
  },
  fn: async function ({ jobId, token, appId, policyRevision }) {
    const now = Date.now()
    const job = await CiJob.updateOne({
      jobId,
      app: appId,
      state: 'running',
      leaseToken: token,
      leaseExpires: { '>': now },
      deadline: { '>': now },
      policyRevision
    }).set({ leaseExpires: now + 30000 })
    if (!job) throw new Error('Checks-only CI lost its job lease or deadline.')
    return job
  }
}
