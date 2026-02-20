module.exports = {
  friendlyName: 'Create app',

  description: 'Create a new app in an environment, optionally linking a GitHub repository.',

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
    name: {
      type: 'string',
      required: true,
      description: 'Human-readable name for the app'
    },
    dockerfilePath: {
      type: 'string',
      defaultsTo: 'Dockerfile'
    },
    routePath: {
      type: 'string',
      allowNull: true,
      defaultsTo: '/',
      description: 'Caddy route path (/, /api, or null for workers)'
    },
    repoId: {
      type: 'string',
      description: 'GitHub repository ID to connect (optional)'
    },
    branch: {
      type: 'string',
      description: 'Branch to deploy from (defaults to repo default branch)'
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

  fn: async function ({ slug, envSlug, name, dockerfilePath, routePath, repoId, branch }) {
    const user = await User.findOne({ id: this.req.session.userId })

    const project = await Project.findOne({ slug }).populate('team')
    if (!project || project.team.id !== user.team) throw { notFound: '/' }

    const environment = await Environment.findOne({ project: project.id, slug: envSlug })
    if (!environment) throw { notFound: `/projects/${slug}` }

    let app
    try {
      app = await App.create({
        name,
        dockerfilePath,
        routePath,
        environment: environment.id,
        isDefault: false
      }).fetch()
    } catch (err) {
      sails.inertia.flash('error', err.message || 'Failed to create app')
      return `/projects/${slug}/environments/${envSlug}`
    }

    // Optionally connect a GitHub repository
    if (repoId) {
      try {
        const provider = await GitProvider.findOne({
          team: user.team,
          type: 'github',
          isActive: true
        }).decrypt()

        if (provider) {
          const repos = await sails.helpers.git.listGithubRepos(provider.clientSecret, 1, 100)
          const repoInfo = repos.find(r => r.id === repoId)

          if (repoInfo) {
            // Generate deploy key
            const { publicKey, privateKey } = await sails.helpers.git.generateDeployKey(repoInfo.name)

            // Add deploy key to GitHub
            let deployKeyId
            try {
              const key = await sails.helpers.git.addGithubDeployKey(
                provider.clientSecret,
                repoInfo.owner,
                repoInfo.name,
                `Slipway Deploy (${project.name} - ${name})`,
                publicKey
              )
              deployKeyId = key.id
            } catch (err) {
              if (err === 'keyExists') {
                sails.log.warn('Deploy key already exists, continuing...')
              } else {
                throw err
              }
            }

            // Generate webhook secret and create webhook
            const webhookSecret = await sails.helpers.strings.random('url-friendly')
            const webhookUrl = `${sails.config.custom.baseUrl}/webhook/github`

            let webhookId
            try {
              const hook = await sails.helpers.git.createGithubWebhook(
                provider.clientSecret,
                repoInfo.owner,
                repoInfo.name,
                webhookUrl,
                webhookSecret
              )
              webhookId = hook.id
            } catch (err) {
              sails.log.error('Failed to create webhook:', err)
            }

            // Create repository record linked to the app
            await GitRepository.create({
              externalId: repoId,
              fullName: repoInfo.fullName,
              name: repoInfo.name,
              owner: repoInfo.owner,
              cloneUrl: repoInfo.cloneUrl,
              htmlUrl: repoInfo.htmlUrl,
              defaultBranch: repoInfo.defaultBranch,
              isPrivate: repoInfo.isPrivate,
              deployKeyId,
              deployKeyPublic: publicKey,
              deployKeyPrivate: privateKey,
              webhookId,
              webhookSecret,
              webhookUrl,
              branchMappings: { [branch || repoInfo.defaultBranch]: environment.slug },
              provider: provider.id,
              environment: environment.id,
              app: app.id
            })

            sails.log.info(`[git] Connected ${repoInfo.fullName} to ${project.slug}/${envSlug} (app: ${app.slug})`)
            sails.inertia.flash('success', `App created and ${repoInfo.fullName} connected`)
            return `/projects/${slug}/environments/${envSlug}`
          }
        }
      } catch (err) {
        sails.log.error('[git] Failed to connect repo during app creation:', err)
        // App was still created, just no repo link
      }
    }

    sails.inertia.flash('success', 'App created')
    return `/projects/${slug}/environments/${envSlug}`
  }
}
