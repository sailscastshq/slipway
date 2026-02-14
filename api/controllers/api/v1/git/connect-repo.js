/**
 * Connect a GitHub repository
 */
module.exports = {
  friendlyName: 'Connect Repo',

  description: 'Connect a GitHub repository to an environment for push-to-deploy.',

  inputs: {
    repoId: {
      type: 'string',
      required: true,
      description: 'GitHub repository ID'
    },
    environmentId: {
      type: 'string',
      required: true,
      description: 'Environment to deploy to'
    },
    branchMappings: {
      type: 'json',
      defaultsTo: {},
      description: 'Branch to environment mapping'
    }
  },

  exits: {
    success: {
      statusCode: 201
    },
    notFound: {
      statusCode: 404
    },
    forbidden: {
      statusCode: 403
    },
    alreadyConnected: {
      statusCode: 409
    }
  },

  fn: async function ({ repoId, environmentId, branchMappings }) {
    const user = await User.findOne({ id: this.req.session.userId })

    // Find GitHub provider
    const provider = await GitProvider.findOne({
      team: user.team,
      type: 'github',
      isActive: true
    }).decrypt()

    if (!provider) {
      throw { notFound: { message: 'GitHub not connected' } }
    }

    // Verify environment access
    const environment = await Environment.findOne({ id: environmentId })
      .populate('project')

    if (!environment) {
      throw 'notFound'
    }

    const project = await Project.findOne({ id: environment.project.id })
      .populate('team')

    if (project.team.id !== user.team) {
      throw 'forbidden'
    }

    // Check if already connected
    const existing = await GitRepository.findOne({
      externalId: repoId,
      provider: provider.id
    })

    if (existing) {
      throw { alreadyConnected: { message: 'Repository already connected' } }
    }

    // Get repo details from GitHub
    const repos = await sails.helpers.git.listGithubRepos(provider.clientSecret, 1, 100)
    const repoInfo = repos.find(r => r.id === repoId)

    if (!repoInfo) {
      throw { notFound: { message: 'Repository not found' } }
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
        `Slipway Deploy (${project.name})`,
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

    // Generate webhook secret
    const webhookSecret = await sails.helpers.strings.random('url-friendly')
    const webhookUrl = `${sails.config.custom.baseUrl}/webhook/github`

    // Create webhook on GitHub
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
      // Continue without webhook - can be added manually
    }

    // Create repository record
    const gitRepo = await GitRepository.create({
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
      branchMappings: branchMappings || { [repoInfo.defaultBranch]: environment.slug },
      provider: provider.id,
      environment: environment.id
    }).fetch()

    sails.log.info(`[git] Connected ${repoInfo.fullName} to ${project.slug}/${environment.slug}`)

    return {
      repository: {
        id: gitRepo.id,
        fullName: gitRepo.fullName,
        defaultBranch: gitRepo.defaultBranch,
        webhookActive: !!webhookId,
        deployKeyActive: !!deployKeyId
      }
    }
  }
}
