module.exports = {
  friendlyName: 'Connect repo',

  description: 'Connect a GitHub repository to an existing app for push-to-deploy.',

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
    repoId: {
      type: 'string',
      required: true,
      description: 'GitHub repository ID'
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

  fn: async function ({ slug, envSlug, appSlug, repoId, branch }) {
    const user = await User.findOne({ id: this.req.session.userId })
    const redirectUrl = `/projects/${slug}/environments/${envSlug}/apps/${appSlug}/settings`

    const project = await Project.findOne({ slug }).populate('team')
    if (!project || project.team.id !== user.team) throw { notFound: '/' }

    const environment = await Environment.findOne({ project: project.id, slug: envSlug })
    if (!environment) throw { notFound: `/projects/${slug}` }

    const app = await App.findOne({ environment: environment.id, slug: appSlug })
    if (!app) throw { notFound: `/projects/${slug}/environments/${envSlug}` }

    // Find GitHub provider
    const provider = await GitProvider.findOne({
      team: user.team,
      type: 'github',
      isActive: true
    }).decrypt()

    if (!provider) {
      sails.inertia.flash('error', 'GitHub is not connected. Configure it in Settings > Git.')
      return redirectUrl
    }

    // Check if already connected
    const existing = await GitRepository.findOne({ externalId: repoId, provider: provider.id })
    if (existing) {
      sails.inertia.flash('error', 'This repository is already connected')
      return redirectUrl
    }

    // Get repo details from GitHub
    const repos = await sails.helpers.git.listGithubRepos(provider.clientSecret, 1, 100)
    const repoInfo = repos.find(r => r.id === repoId)

    if (!repoInfo) {
      sails.inertia.flash('error', 'Repository not found on GitHub')
      return redirectUrl
    }

    // Generate deploy key
    const { publicKey, privateKey } = await sails.helpers.git.generateDeployKey(repoInfo.name)

    // Add deploy key to GitHub
    let deployKeyId
    try {
      const key = await sails.helpers.git.addGithubDeployKey(
        provider.clientSecret,
        repoInfo.owner,
        repoInfo.name,
        `Slipway Deploy (${project.name} - ${app.name})`,
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
    const instanceUrl = await sails.helpers.getInstanceUrl()
    const webhookUrl = `${instanceUrl}/webhook/github`

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

    sails.log.info(`[git] Connected ${repoInfo.fullName} to app ${app.slug} (${project.slug}/${envSlug})`)
    sails.inertia.flash('success', 'Repository connected')
    return redirectUrl
  }
}
