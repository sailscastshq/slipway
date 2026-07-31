/**
 * Create Deploy Token
 */
module.exports = {
  friendlyName: 'Create Deploy Token',

  description: 'Create a new deploy token for CI/CD.',

  inputs: {
    name: {
      type: 'string',
      required: true,
      description: 'Token name (e.g., "GitHub Actions")'
    },
    projectId: {
      type: 'string',
      description: 'Scope to specific project (optional)'
    },
    environmentId: {
      type: 'string',
      description: 'Scope to specific environment (optional)'
    },
    scopes: {
      type: 'json',
      defaultsTo: ['deploy'],
      description: 'Allowed actions'
    },
    expiresInDays: {
      type: 'number',
      description: 'Token expiration in days (optional)'
    }
  },

  exits: {
    success: {
      statusCode: 201
    },
    forbidden: {
      statusCode: 403
    },
    invalid: {
      responseType: 'badRequest'
    },
    precognitionSuccess: {
      responseType: 'precognitionSuccess'
    }
  },

  fn: async function ({
    name,
    projectId,
    environmentId,
    scopes,
    expiresInDays
  }) {
    const user = await User.findOne({ id: this.req.session.userId })

    const problems = sails.helpers.setting.validate(
      { name, scopes, expiresInDays },
      ['name'],
      this.req
    )
    if (problems.length) {
      throw { invalid: { problems } }
    }

    // Validate project access if scoped
    if (projectId) {
      const project = await Project.findOne({ id: projectId }).populate('team')
      if (!project || project.team.id !== user.team) {
        throw 'forbidden'
      }
    }

    // Validate environment access if scoped
    if (environmentId) {
      const env = await Environment.findOne({ id: environmentId }).populate(
        'project'
      )
      if (!env) {
        throw 'forbidden'
      }
      const project = await Project.findOne({ id: env.project.id }).populate(
        'team'
      )
      if (project.team.id !== user.team) {
        throw 'forbidden'
      }
    }

    if (sails.inertia.isPrecognitive(this.req)) {
      throw 'precognitionSuccess'
    }

    // Calculate expiration
    let expiresAt = null
    if (expiresInDays) {
      expiresAt = Date.now() + expiresInDays * 24 * 60 * 60 * 1000
    }

    // Generate token
    const tokenData = await DeployToken.generateToken({
      name,
      scopes,
      expiresAt,
      project: projectId || null,
      environment: environmentId || null,
      createdBy: user.id,
      team: user.team
    })

    sails.log.info(`[token] Deploy token "${name}" created by ${user.email}`)

    return {
      token: tokenData.token, // Plain text - only shown once!
      tokenPrefix: tokenData.tokenPrefix,
      name: tokenData.name,
      scopes: tokenData.scopes,
      expiresAt: tokenData.expiresAt,
      createdAt: tokenData.createdAt,
      warning: 'Save this token now. You will not be able to see it again.'
    }
  }
}
