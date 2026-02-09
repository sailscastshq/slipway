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

  fn: async function ({ slug, envSlug }) {
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
    }).populate('services')

    if (!environment) {
      throw { notFound: `/projects/${slug}` }
    }

    // Get database service
    const dbService = (environment.services || []).find(
      s => ['postgresql', 'mysql'].includes(s.type) && s.status === 'running'
    )

    const app = await App.findOne({ environment: environment.id })

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
        hasDatabaseService: !!dbService,
        databaseService: dbService ? {
          id: dbService.id,
          name: dbService.name,
          type: dbService.type,
          database: dbService.database,
          status: dbService.status
        } : null,
        appRunning: app && app.status === 'running'
      }
    }
  }
}
