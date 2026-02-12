/**
 * List Deploy Tokens
 */
module.exports = {
  friendlyName: 'List Deploy Tokens',

  description: 'List all deploy tokens for the team.',

  inputs: {},

  exits: {
    success: {
      statusCode: 200
    }
  },

  fn: async function () {
    const user = await User.findOne({ id: this.req.session.userId })

    const tokens = await DeployToken.find({
      team: user.team,
      isActive: true
    })
      .populate('project')
      .populate('environment')
      .populate('createdBy')
      .sort('createdAt DESC')

    return {
      tokens: tokens.map(t => ({
        id: t.id,
        name: t.name,
        tokenPrefix: t.tokenPrefix,
        scopes: t.scopes,
        project: t.project ? { id: t.project.id, name: t.project.name } : null,
        environment: t.environment ? { id: t.environment.id, slug: t.environment.slug } : null,
        createdBy: t.createdBy ? { email: t.createdBy.email } : null,
        createdAt: t.createdAt,
        expiresAt: t.expiresAt,
        lastUsedAt: t.lastUsedAt,
        usageCount: t.usageCount
      }))
    }
  }
}
