module.exports = {
  friendlyName: 'View Dock',

  description: 'Display the Dock database management page.',

  inputs: {
    slug: {
      type: 'string',
      required: true
    },
    envSlug: {
      type: 'string',
      defaultsTo: 'production'
    },
    serviceId: {
      type: 'string',
      description: 'Optional service ID - if not provided, shows service picker'
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
    }).populate('services')

    if (!environment) {
      throw { notFound: `/projects/${slug}` }
    }

    // Get all database services (running)
    const allDbServices = (environment.services || []).filter(
      (s) =>
        ['postgresql', 'mysql', 'mongodb', 'redis'].includes(s.type) &&
        s.status === 'running'
    )

    // If no serviceId provided, show the service picker
    if (!serviceId) {
      return {
        page: 'projects/dock',
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
          // No service selected - show picker mode
          databaseService: null,
          availableServices: allDbServices.map((s) => ({
            id: s.id,
            name: s.name,
            type: s.type,
            database: s.database,
            status: s.status
          }))
        }
      }
    }

    // Find the specific service (serviceId comes as string from URL)
    const dbService = allDbServices.find((s) => String(s.id) === serviceId)

    if (!dbService) {
      // Service not found or not running - redirect to dock picker
      throw { notFound: `/projects/${slug}/environments/${envSlug}/dock` }
    }

    const app =
      (await App.findOne({ environment: environment.id, isDefault: true })) ||
      (await App.findOne({ environment: environment.id }))

    return {
      page: 'projects/dock',
      props: {
        project: {
          id: project.id,
          name: project.name,
          slug: project.slug
        },
        environment: {
          id: environment.id,
          name: environment.name,
          slug: environment.slug,
          features: environment.features
        },
        databaseService: {
          id: dbService.id,
          name: dbService.name,
          type: dbService.type,
          database: dbService.database,
          status: dbService.status
        },
        availableServices: allDbServices.map((s) => ({
          id: s.id,
          name: s.name,
          type: s.type
        })),
        appRunning: app && app.status === 'running'
      }
    }
  }
}
