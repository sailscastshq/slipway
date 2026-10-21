module.exports = {
  friendlyName: 'Retry service provisioning',
  description:
    'Resume interrupted provisioning on the same managed service record.',
  inputs: { serviceId: { type: 'string', required: true } },
  exits: {
    success: { statusCode: 200 },
    notFound: { statusCode: 404 },
    conflict: { statusCode: 409 },
    failed: { statusCode: 422 }
  },
  fn: async function ({ serviceId }) {
    const user = await User.forRequest(this.req)
    const service = await Service.findOne({ id: serviceId })
    if (!service) throw 'notFound'
    const environment = await Environment.findOne({ id: service.environment })
    const project =
      environment && (await Project.findOne({ id: environment.project }))
    if (!project || Number(project.team) !== Number(user.team)) throw 'notFound'
    try {
      return await require('../../../../lib/service-provisioning').provision({
        serviceId,
        retry: true,
        actor: {
          userId: String(user.id),
          userName: user.fullName,
          teamId: String(user.team),
          ipAddress: this.req.ip
        }
      })
    } catch (error) {
      if (error.code === 'PROVISIONING_CONFLICT')
        throw { conflict: { message: error.message } }
      throw { failed: { message: error.message } }
    }
  }
}
