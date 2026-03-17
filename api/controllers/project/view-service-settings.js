module.exports = {
  friendlyName: 'View service settings',

  description: 'Display settings page for a service.',

  inputs: {
    slug: {
      type: 'string',
      required: true,
      description: 'Project slug'
    },
    envSlug: {
      type: 'string',
      required: true,
      description: 'Environment slug'
    },
    serviceId: {
      type: 'string',
      required: true,
      description: 'Service ID'
    }
  },

  exits: {
    success: {
      responseType: 'inertia'
    },
    notFound: {
      responseType: 'redirect'
    }
  },

  fn: async function ({ slug, envSlug, serviceId }) {
    const user = await User.findOne({ id: this.req.session.userId }).populate(
      'team'
    )

    const project = await Project.findOne({ slug, team: user.team.id })
    if (!project) throw { notFound: '/' }

    const environment = await Environment.findOne({
      slug: envSlug,
      project: project.id
    })
    if (!environment) throw { notFound: `/projects/${slug}` }

    const service = await Service.findOne({
      id: serviceId,
      environment: environment.id
    })
    if (!service)
      throw { notFound: `/projects/${slug}/environments/${envSlug}` }

    return {
      page: 'projects/service-settings',
      props: {
        project: {
          id: project.id,
          name: project.name,
          slug: project.slug
        },
        environment: {
          id: environment.id,
          name: environment.name,
          slug: environment.slug
        },
        service: {
          id: service.id,
          name: service.name,
          type: service.type,
          status: service.status,
          resourceLimits: service.resourceLimits
        }
      }
    }
  }
}
