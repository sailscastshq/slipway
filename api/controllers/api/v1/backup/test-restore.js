module.exports = {
  friendlyName: 'Test backup restoration',
  inputs: { backupId: { type: 'number' }, serviceId: { type: 'number' } },
  exits: {
    success: { statusCode: 202 },
    notFound: { statusCode: 404 },
    forbidden: { statusCode: 403 },
    badRequest: { statusCode: 400 }
  },
  fn: async function ({ backupId, serviceId }) {
    const user = await User.forRequest(this.req)
    const backup = backupId
      ? await Backup.findOne({ id: backupId }).populate('service')
      : null
    const service =
      backup?.service ||
      (!backupId && serviceId ? await Service.findOne({ id: serviceId }) : null)
    if (!service) throw 'notFound'
    const environment = await Environment.findOne({
      id: service.environment
    })
    const project =
      environment && (await Project.findOne({ id: environment.project }))
    if (project?.team !== user.team) throw 'forbidden'
    try {
      const test = await sails.helpers.backup.manageRestoreTests.with({
        action: 'enqueue',
        backupId,
        serviceId: service.id,
        teamId: user.team,
        userId: user.id
      })
      return {
        test: {
          id: test.id,
          backup: test.backup,
          status: test.status,
          stage: test.stage
        }
      }
    } catch (error) {
      throw { badRequest: { message: error.message } }
    }
  }
}
