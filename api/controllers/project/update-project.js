module.exports = {
  friendlyName: 'Update project',

  description: 'Update project settings.',

  inputs: {
    slug: {
      type: 'string',
      required: true,
      description: 'Project slug'
    },
    name: {
      type: 'string',
      description: 'Project name'
    },
    description: {
      type: 'string',
      allowNull: true,
      description: 'Project description'
    },
    repositoryUrl: {
      type: 'string',
      allowNull: true,
      description: 'Git repository URL'
    },
    autoDeploy: {
      type: 'boolean',
      description: 'Enable auto-deploy on webhook push'
    },
    autoDeployBranch: {
      type: 'string',
      description: 'Branch that triggers auto-deploy'
    },
    generateWebhookSecret: {
      type: 'boolean',
      description: 'Generate a new webhook secret'
    }
  },

  exits: {
    success: {
      responseType: 'inertiaRedirect'
    },
    notFound: {
      responseType: 'inertiaRedirect'
    }
  },

  fn: async function ({ slug, name, description, repositoryUrl, autoDeploy, autoDeployBranch, generateWebhookSecret }) {
    const user = await User.findOne({ id: this.req.session.userId }).populate('team')

    const project = await Project.findOne({ slug, team: user.team.id })

    if (!project) {
      throw { notFound: '/' }
    }

    const updates = {}
    if (name !== undefined) updates.name = name
    if (description !== undefined) updates.description = description
    if (repositoryUrl !== undefined) updates.repositoryUrl = repositoryUrl
    if (autoDeploy !== undefined) updates.autoDeploy = autoDeploy
    if (autoDeployBranch !== undefined) updates.autoDeployBranch = autoDeployBranch

    // Generate a new webhook secret if requested
    if (generateWebhookSecret) {
      const crypto = require('crypto')
      updates.webhookSecret = crypto.randomBytes(32).toString('hex')
    }

    await Project.updateOne({ id: project.id }).set(updates)

    sails.inertia.flash('success', 'Project updated.')
    return `/projects/${project.slug}/settings`
  }
}
