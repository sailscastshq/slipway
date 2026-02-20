module.exports = {
  friendlyName: 'Update repo',

  description: 'Update repository settings like auto-deploy.',

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
    appSlug: {
      type: 'string',
      required: true,
      description: 'App slug'
    },
    autoDeploy: {
      type: 'boolean',
      required: true,
      description: 'Whether to automatically deploy on push'
    }
  },

  exits: {
    success: {
      responseType: 'inertiaRedirect'
    },
    notFound: {
      responseType: 'redirect'
    }
  },

  fn: async function ({ slug, envSlug, appSlug, autoDeploy }) {
    const user = await User.findOne({ id: this.req.session.userId })
    const redirectUrl = `/projects/${slug}/environments/${envSlug}/apps/${appSlug}/settings`

    const project = await Project.findOne({ slug }).populate('team')
    if (!project || project.team.id !== user.team) throw { notFound: '/' }

    const environment = await Environment.findOne({ slug: envSlug, project: project.id })
    if (!environment) throw { notFound: `/projects/${slug}` }

    const app = await App.findOne({ environment: environment.id, slug: appSlug })
    if (!app) throw { notFound: `/projects/${slug}/environments/${envSlug}` }

    const repo = await GitRepository.findOne({ app: app.id })
    if (!repo) {
      sails.inertia.flash('error', 'No repository connected to this app')
      return redirectUrl
    }

    await GitRepository.updateOne({ id: repo.id }).set({ autoDeploy })

    sails.inertia.flash('success', `Auto-deploy ${autoDeploy ? 'enabled' : 'disabled'}`)
    return redirectUrl
  }
}
