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

    // Check if sails-quest is available
    const hasQuestFeature = !!(environment.features && environment.features['sails-quest'])
    const questFeature = hasQuestFeature ? environment.features['sails-quest'] : null

    // Get app status
    const app = await App.findOne({ environment: environment.id })
    const appRunning = app && app.status === 'running'

    // Load jobs if app is running and quest is available
    let jobs = []
    let jobsError = null

    if (hasQuestFeature && appRunning && app.containerName) {
      try {
        const result = await sails.helpers.quest.listJobs(app.containerName, questFeature)
        jobs = result.jobs || []
        jobsError = result.error
      } catch (err) {
        jobsError = err.message
      }
    } else if (hasQuestFeature && !appRunning) {
      // Return scripts from detection as manual-only jobs when app not running
      const scripts = questFeature.scripts || []
      jobs = scripts.map(s => ({
        name: s.name,
        friendlyName: s.name,
        description: '',
        schedule: null,
        scheduleType: 'manual',
        paused: false,
        withoutOverlapping: false,
        isRunning: false
      }))
    }

    return {
      page: 'projects/quest',
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
        hasQuestFeature,
        questFeature,
        appRunning,
        jobs,
        jobsError
      }
    }
  }
}
