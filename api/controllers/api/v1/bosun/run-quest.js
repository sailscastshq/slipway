module.exports = {
  friendlyName: 'Run instance Quest job',
  inputs: {
    name: { type: 'string', required: true },
    requestId: { type: 'string', required: true },
    jobInputs: { type: 'ref', defaultsTo: {} }
  },
  exits: {
    success: { statusCode: 202 },
    duplicate: { statusCode: 200 },
    invalid: { statusCode: 400 },
    conflict: { statusCode: 409 },
    unavailable: { statusCode: 503 }
  },
  fn: async function ({ name, requestId, jobInputs }) {
    if (!sails.instanceQuest)
      throw { unavailable: { error: 'Instance Quest is unavailable.' } }
    let result
    try {
      result = await sails.instanceQuest.trigger(name, requestId, jobInputs)
    } catch (error) {
      const exit = { 400: 'invalid', 409: 'conflict', 503: 'unavailable' }[
        error.status
      ]
      if (exit) throw { [exit]: { error: error.message } }
      throw error
    }
    if (!result.duplicate && name === 'retain-build-cache') {
      const user = await User.forRequest(this.req)
      await AuditLog.create({
        action: 'infrastructure.cache-prune.requested',
        resourceType: 'build-cache-retention',
        resourceId: requestId,
        user: user.id,
        team: user.team,
        ipAddress: this.req.ip,
        details: { name, preview: jobInputs?.preview === true }
      })
    }
    if (result.duplicate) throw { duplicate: result }
    return result
  }
}
