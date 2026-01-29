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
    }
  },

  exits: {
    success: {
      responseType: 'redirect'
    },
    notFound: {
      responseType: 'redirect'
    }
  },

  fn: async function ({ slug, name, description, repositoryUrl }) {
    const user = await User.findOne({ id: this.req.session.userId }).populate('team')

    const project = await Project.findOne({ slug, team: user.team.id })

    if (!project) {
      throw { notFound: '/' }
    }

    const updates = {}
    if (name !== undefined) updates.name = name
    if (description !== undefined) updates.description = description
    if (repositoryUrl !== undefined) updates.repositoryUrl = repositoryUrl

    await Project.updateOne({ id: project.id }).set(updates)

    return `/projects/${project.slug}/settings`
  }
}
