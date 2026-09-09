module.exports = {
  friendlyName: 'Verify external database',
  inputs: { serviceId: { type: 'string', required: true } },
  exits: {
    success: { statusCode: 200 },
    notFound: { statusCode: 404 },
    forbidden: { statusCode: 403 },
    badRequest: { responseType: 'badRequest' }
  },
  fn: async function ({ serviceId }) {
    const user = await User.forRequest(this.req)
    const service = await Service.findOne({ id: serviceId }).populate(
      'environment'
    )
    if (!service) throw 'notFound'
    const project = await Project.findOne({ id: service.environment.project })
    if (
      project.team !== user.team ||
      !['owner', 'admin'].includes(user.teamRole)
    )
      throw 'forbidden'
    if (service.managementMode !== 'external')
      throw { badRequest: { message: 'This service is managed by Slipway.' } }
    const verification = await sails.helpers.service.verifyExternal(serviceId)
    await sails.helpers.audit.log.with({
      action: 'service.external.verified',
      resourceType: 'service',
      resourceId: serviceId,
      details: { status: verification.status, code: verification.code || null },
      userId: user.id,
      teamId: project.team,
      ipAddress: this.req.ip
    })
    return { verification }
  }
}
