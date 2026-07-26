module.exports = {
  friendlyName: 'Delete environment',

  description:
    'Run the shared, resumable cleanup for an environment and its resources.',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true,
      description: 'Project slug'
    },
    slug: {
      type: 'string',
      required: true,
      description: 'Environment slug'
    },
    purgeData: {
      type: 'boolean',
      defaultsTo: false
    }
  },

  exits: {
    success: { statusCode: 200 },
    notFound: { statusCode: 404 },
    forbidden: { statusCode: 403 },
    badRequest: { responseType: 'badRequest' },
    cleanupFailed: {
      statusCode: 409,
      description: 'Cleanup paused and can be resumed'
    }
  },

  fn: async function ({ projectSlug, slug, purgeData }) {
    const user = await User.findOne({ id: this.req.session.userId })
    const project = await Project.findOne({ slug: projectSlug }).populate(
      'team'
    )

    if (!project) throw 'notFound'
    if (Number(project.team.id) !== Number(user.team)) throw 'forbidden'
    if (user.teamRole !== 'owner' && user.teamRole !== 'admin') {
      throw 'forbidden'
    }

    const requestKey = `environment:${projectSlug}/${slug}`
    const environment = await Environment.findOne({
      project: project.id,
      slug
    })
    const targetKey = environment ? `environment:${environment.id}` : undefined
    const existingOperation = await sails.helpers.cleanup.findOperation.with({
      targetKey,
      requestKey
    })
    if (!environment && !existingOperation) throw 'notFound'

    if (environment?.isProduction) {
      const envCount = await Environment.count({ project: project.id })
      if (envCount === 1) {
        throw {
          badRequest: {
            problems: [
              { environment: 'Cannot delete the only production environment.' }
            ]
          }
        }
      }
    }

    try {
      const cleanup = await sails.helpers.cleanup.run.with({
        targetKey: targetKey || existingOperation.targetKey,
        requestKey,
        scopeType: 'environment',
        resourceId: environment?.id || existingOperation.resourceId,
        retentionPolicy: purgeData ? 'purge' : 'retain',
        userId: user.id,
        teamId: project.team.id,
        ipAddress: this.req.ip
      })

      return {
        message: 'Environment deleted successfully',
        cleanup
      }
    } catch (error) {
      throw {
        cleanupFailed: {
          message: error.message,
          cleanup: error.cleanup || null
        }
      }
    }
  }
}
