module.exports = {
  friendlyName: 'Delete project',

  description:
    'Run the shared, resumable cleanup for a project and its resources.',

  inputs: {
    slug: {
      type: 'string',
      required: true,
      description: 'Project slug'
    },
    purgeData: {
      type: 'boolean',
      defaultsTo: false
    }
  },

  exits: {
    success: {
      statusCode: 200
    },
    notFound: {
      statusCode: 404,
      description: 'Project not found'
    },
    forbidden: {
      statusCode: 403,
      description: 'Not authorized to delete this project'
    },
    cleanupFailed: {
      statusCode: 409,
      description: 'Cleanup paused and can be resumed'
    }
  },

  fn: async function ({ slug, purgeData }) {
    const user = await User.findOne({ id: this.req.session.userId })
    const requestKey = `project:${slug}`
    const project = await Project.findOne({ slug }).populate('team')
    const targetKey = project ? `project:${project.id}` : undefined
    const existingOperation = await sails.helpers.cleanup.findOperation.with({
      targetKey,
      requestKey
    })

    if (!project && !existingOperation) throw 'notFound'
    const teamId = project ? project.team.id : existingOperation.team

    if (Number(teamId) !== Number(user.team)) throw 'forbidden'
    if (user.teamRole !== 'owner' && user.teamRole !== 'admin') {
      throw 'forbidden'
    }

    try {
      const cleanup = await sails.helpers.cleanup.run.with({
        targetKey: targetKey || existingOperation.targetKey,
        requestKey,
        scopeType: 'project',
        resourceId: project?.id || existingOperation.resourceId,
        retentionPolicy: purgeData ? 'purge' : 'retain',
        userId: user.id,
        teamId,
        ipAddress: this.req.ip
      })

      return {
        message: 'Project deleted successfully',
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
