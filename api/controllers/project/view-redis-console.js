module.exports = {
  friendlyName: 'View Redis console',

  description: 'Display the Redis CLI console page for a service.',

  inputs: {
    slug: {
      type: 'string',
      required: true
    },
    envSlug: {
      type: 'string',
      required: true
    },
    serviceId: {
      type: 'number',
      required: true
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
    const user = await User.findOne({ id: this.req.session.userId }).populate('team')

    if (!user) {
      throw { notFound: '/login' }
    }

    const project = await Project.findOne({ slug, team: user.team.id })

    if (!project) {
      throw { notFound: '/' }
    }

    const environment = await Environment.findOne({
      project: project.id,
      slug: envSlug
    })

    if (!environment) {
      throw { notFound: `/projects/${slug}` }
    }

    const service = await Service.findOne({
      id: serviceId,
      environment: environment.id,
      type: 'redis'
    })

    if (!service) {
      throw { notFound: `/projects/${slug}/environments/${envSlug}?services=1` }
    }

    return {
      page: 'projects/redis-console',
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
          status: service.status
        }
      }
    }
  }
}
