module.exports = {
  friendlyName: 'View Bridge create',

  description: 'Display the create form for a Waterline model.',

  inputs: {
    slug: {
      type: 'string',
      required: true
    },
    envSlug: {
      type: 'string',
      defaultsTo: 'production'
    },
    modelIdentity: {
      type: 'string',
      required: true
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

  fn: async function ({ slug, envSlug, modelIdentity }) {
    const user = await User.findOne({ id: this.req.session.userId }).populate(
      'team'
    )

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

    const app =
      (await App.findOne({ environment: environment.id, isDefault: true })) ||
      (await App.findOne({ environment: environment.id }))
    const appRunning = app && app.status === 'running'

    let modelMeta = null
    let assocOptions = {}
    let error = null

    if (appRunning) {
      try {
        const actor = await sails.helpers.bridge.buildActor.with({
          user,
          project,
          environment
        })
        const loaded = await sails.helpers.bridge.loadResource.with({
          containerName: app.containerName,
          environmentId: environment.id,
          modelIdentity,
          action: 'create',
          actor
        })
        modelMeta = loaded.resource
        assocOptions = await sails.helpers.bridge.loadAssociationOptions.with({
          containerName: app.containerName,
          resources: loaded.contract.models,
          resource: modelMeta,
          surface: 'create'
        })
      } catch (err) {
        error = err.message
      }
    }

    return {
      page: 'projects/bridge-form',
      props: {
        project: {
          id: project.id,
          name: project.name,
          slug: project.slug
        },
        environment: {
          id: environment.id,
          name: environment.name,
          slug: environment.slug
        },
        mode: 'create',
        modelIdentity,
        recordId: null,
        appRunning,
        modelMeta,
        record: null,
        assocOptions,
        error
      }
    }
  }
}
