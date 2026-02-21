module.exports = {
  friendlyName: 'View project settings',

  description: 'Display the project settings page.',

  inputs: {
    slug: {
      type: 'string',
      required: true,
      description: 'Project slug'
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

  fn: async function ({ slug }) {
    const user = await User.findOne({ id: this.req.session.userId }).populate('team')

    const project = await Project.findOne({ slug, team: user.team.id })

    if (!project) {
      throw { notFound: '/' }
    }

    const baseUrl = await sails.helpers.getInstanceUrl()
    const webhookUrl = `${baseUrl}/api/v1/webhooks/github/${project.slug}`

    return {
      page: 'projects/settings',
      props: {
        project,
        webhookUrl
      }
    }
  }
}
