module.exports = {
  friendlyName: 'View Quest',

  description: 'Display the Quest job scheduler dashboard for a project.',

  inputs: {
    slug: {
      type: 'string',
      required: true,
      description: 'Project slug'
    },
    envSlug: {
      type: 'string',
      defaultsTo: 'production',
      description: 'Environment slug'
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
    const user = await User.forRequest(this.req, { populateTeam: true })

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

    // Check if sails-quest is available
    const hasQuestFeature = !!(
      environment.features && environment.features['sails-quest']
    )
    const questFeature = hasQuestFeature
      ? environment.features['sails-quest']
      : null

    // Get app status
    let selection
    try {
      selection = await require('../../lib/app-selection')(
        this.req,
        environment.id
      )
    } catch (error) {
      if (error === 'notFound')
        throw { notFound: `/projects/${slug}/environments/${envSlug}` }
      throw error
    }
    const { app, explicit } = selection
    const appRunning = app && app.status === 'running'

    const workspace =
      await require('../../lib/quest-workspace').initialSnapshot({
        user,
        project,
        environment,
        app
      })

    const locals = {}
    if (!this.req.headers?.['x-inertia'])
      locals.questAssetPreloads = require('../../lib/quest-asset-preloads')({
        appPath: sails.config.appPath,
        development:
          sails.config.environment !== 'production' && !!sails.hooks.shipwright
      })

    return {
      page: 'projects/quest',
      locals,
      props: {
        app: app ? { id: app.id, name: app.name, slug: app.slug } : null,
        appSelectionExplicit: explicit,
        project: {
          id: project.id,
          name: project.name,
          slug: project.slug
        },
        environment: {
          id: environment.id,
          name: environment.name,
          slug: environment.slug,
          features: environment.features,
          isProduction: environment.isProduction
        },
        hasQuestFeature,
        questFeature,
        appRunning,
        workspace,
        jobs: workspace.jobs,
        jobHistory: workspace.legacyEvents
      }
    }
  }
}
