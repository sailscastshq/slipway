module.exports = {
  friendlyName: 'Get deployment logs',
  description: 'Get the build and deploy logs for a deployment.',
  inputs: {
    id: {
      type: 'string',
      required: true,
      description: 'Deployment ID'
    },
    type: {
      type: 'string',
      isIn: ['build', 'deploy', 'all'],
      defaultsTo: 'all',
      description: 'Which logs to return'
    }
  },
  exits: {
    success: {
      statusCode: 200
    },
    notFound: {
      statusCode: 404
    },
    forbidden: {
      statusCode: 403
    }
  },
  fn: async function ({ id, type }) {
    const user = await User.findOne({ id: this.req.session.userId })
    const deployment = await Deployment.findOne(id).populate('environment')

    if (!deployment) {
      throw 'notFound'
    }

    // Get the project to check access
    const environment = await Environment.findOne({
      id: deployment.environment.id
    }).populate('project')

    const project = await Project.findOne({
      id: environment.project.id
    }).populate('team')

    if (project.team.id !== user.team) {
      throw 'forbidden'
    }

    const result = {
      deploymentId: deployment.id,
      status: deployment.status
    }
    if (type === 'build' || type === 'all') {
      result.buildLogs = deployment.buildLogs || ''
    }
    if (type === 'deploy' || type === 'all') {
      result.deployLogs = deployment.deployLogs || ''
    }

    return result
  }
}
