module.exports = {
  friendlyName: 'View content editor',

  description: 'Display the content editor page for editing a specific content file.',

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
    },
    collection: {
      type: 'string',
      required: true,
      description: 'Collection name'
    },
    file: {
      type: 'string',
      required: true,
      description: 'File slug'
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

  fn: async function ({ slug, envSlug, collection, file }) {
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

    // Check if sails-content is available
    if (!environment.features || !environment.features['sails-content']) {
      throw { notFound: `/projects/${slug}/environments/${envSlug}` }
    }

    return {
      page: 'projects/content-editor',
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
        collection,
        file,
        contentFeature: environment.features['sails-content']
      }
    }
  }
}
