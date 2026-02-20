module.exports = {
  friendlyName: 'Disconnect repo',

  description: 'Disconnect a GitHub repository from an app and clean up deploy key/webhook.',

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

  fn: async function ({ slug, envSlug, appSlug }) {
    const user = await User.findOne({ id: this.req.session.userId })
    const redirectUrl = `/projects/${slug}/environments/${envSlug}/apps/${appSlug}/settings`

    const project = await Project.findOne({ slug }).populate('team')
    if (!project || project.team.id !== user.team) throw { notFound: '/' }

    const environment = await Environment.findOne({ slug: envSlug, project: project.id })
    if (!environment) throw { notFound: `/projects/${slug}` }

    const app = await App.findOne({ environment: environment.id, slug: appSlug })
    if (!app) throw { notFound: `/projects/${slug}/environments/${envSlug}` }

    const repo = await GitRepository.findOne({ app: app.id }).populate('provider')
    if (!repo) {
      sails.inertia.flash('error', 'No repository connected to this app')
      return redirectUrl
    }

    // Get provider credentials for cleanup
    const provider = await GitProvider.findOne({ id: repo.provider.id }).decrypt()

    if (provider && provider.clientSecret) {
      // Delete deploy key from GitHub
      if (repo.deployKeyId) {
        try {
          const response = await fetch(
            `https://api.github.com/repos/${repo.owner}/${repo.name}/keys/${repo.deployKeyId}`,
            {
              method: 'DELETE',
              headers: {
                Authorization: `token ${provider.clientSecret}`,
                Accept: 'application/vnd.github.v3+json'
              }
            }
          )
          if (response.ok || response.status === 404) {
            sails.log.info(`[git] Removed deploy key ${repo.deployKeyId} from ${repo.fullName}`)
          }
        } catch (err) {
          sails.log.warn(`[git] Failed to remove deploy key: ${err.message}`)
        }
      }

      // Delete webhook from GitHub
      if (repo.webhookId) {
        try {
          const response = await fetch(
            `https://api.github.com/repos/${repo.owner}/${repo.name}/hooks/${repo.webhookId}`,
            {
              method: 'DELETE',
              headers: {
                Authorization: `token ${provider.clientSecret}`,
                Accept: 'application/vnd.github.v3+json'
              }
            }
          )
          if (response.ok || response.status === 404) {
            sails.log.info(`[git] Removed webhook ${repo.webhookId} from ${repo.fullName}`)
          }
        } catch (err) {
          sails.log.warn(`[git] Failed to remove webhook: ${err.message}`)
        }
      }
    }

    // Destroy the repository record
    await GitRepository.destroyOne({ id: repo.id })

    sails.log.info(`[git] Disconnected ${repo.fullName} from app ${appSlug}`)
    sails.inertia.flash('success', 'Repository disconnected')
    return redirectUrl
  }
}
