module.exports = {
  friendlyName: 'Delete Wake visitor history',
  inputs: {
    slug: { type: 'string', required: true },
    envSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true },
    visitor: { type: 'string', required: true }
  },
  exits: { forbidden: { statusCode: 403 }, unavailable: { statusCode: 503 } },
  fn: async function (inputs) {
    let access
    try {
      access = await sails.helpers.wake.resolveAccess.with({
        req: this.req,
        slug: inputs.slug,
        envSlug: inputs.envSlug,
        appSlug: inputs.appSlug
      })
    } catch {
      throw 'forbidden'
    }
    if (!access.canManage || !/^[A-Za-z0-9_-]{8,128}$/.test(inputs.visitor))
      throw 'forbidden'
    try {
      require('../../lib/wake-store').deleteVisitor(
        String(access.app.id),
        inputs.visitor
      )
    } catch {
      throw 'unavailable'
    }
    await sails.helpers.audit.log.with({
      action: 'wake.visitor.deleted',
      resourceType: 'app',
      resourceId: String(access.app.id),
      userId: String(access.user.id),
      teamId: String(access.user.team),
      details: {}
    })
    return { deleted: true }
  }
}
