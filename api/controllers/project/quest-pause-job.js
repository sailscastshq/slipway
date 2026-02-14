module.exports = {
  friendlyName: 'Quest pause job',

  description: 'Pause a scheduled Quest job.',

  inputs: {
    slug: {
      type: 'string',
      required: true
    },
    envSlug: {
      type: 'string',
      defaultsTo: 'production'
    },
    jobName: {
      type: 'string',
      required: true
    }
  },

  exits: {
    success: {
      responseType: 'redirect'
    },
    notFound: {
      responseType: 'redirect'
    },
    badRequest: {
      responseType: 'badRequest'
    }
  },

  fn: async function ({ slug, envSlug, jobName }) {
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

    if (!environment.features || !environment.features['sails-quest']) {
      throw { badRequest: { error: 'sails-hook-quest not detected in this app.' } }
    }

    const app = await App.findOne({ environment: environment.id, isDefault: true }) || await App.findOne({ environment: environment.id })
    if (!app || app.status !== 'running' || !app.containerName) {
      throw { badRequest: { error: 'App is not running.' } }
    }

    await sails.helpers.quest.pauseJob(app.containerName, jobName)
    sails.log.info(`[quest] Job "${jobName}" paused in ${slug}/${envSlug}`)

    // Redirect back to quest page
    const envPath = envSlug !== 'production' ? `/environments/${envSlug}` : ''
    return `/projects/${slug}${envPath}/quest`
  }
}
