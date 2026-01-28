module.exports = {
  friendlyName: 'List services',

  description: 'List all services for an environment.',

  inputs: {
    projectId: {
      type: 'string',
      required: true,
      description: 'Project ID or slug'
    },
    environmentId: {
      type: 'string',
      required: true,
      description: 'Environment ID or slug'
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

  fn: async function ({ projectId, environmentId }) {
    const user = await User.findOne({ id: this.req.session.userId })

    // Find project
    let project = await Project.findOne({ id: projectId }).populate('team')
    if (!project) {
      project = await Project.findOne({ slug: projectId }).populate('team')
    }

    if (!project) {
      throw 'notFound'
    }

    if (project.team.id !== user.team) {
      throw 'forbidden'
    }

    // Find environment
    let environment = await Environment.findOne({ id: environmentId, project: project.id })
    if (!environment) {
      environment = await Environment.findOne({ slug: environmentId, project: project.id })
    }

    if (!environment) {
      throw 'notFound'
    }

    const services = await Service.find({ environment: environment.id })
      .sort('createdAt ASC')

    // Add connection URLs (without exposing passwords in list)
    const servicesWithInfo = services.map(service => ({
      id: service.id,
      name: service.name,
      type: service.type,
      version: service.version,
      status: service.status,
      internalHost: service.internalHost,
      internalPort: service.internalPort,
      database: service.database,
      createdAt: service.createdAt
    }))

    return { services: servicesWithInfo }
  }
}
