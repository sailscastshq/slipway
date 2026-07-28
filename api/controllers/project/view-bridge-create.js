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
    appSlug: {
      type: 'string'
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
    },
    forbidden: {
      statusCode: 403
    }
  },

  fn: async function ({ slug, envSlug, appSlug, modelIdentity }) {
    let resolved
    try {
      resolved = await sails.helpers.bridge.resolveRequest.with({
        req: this.req,
        projectSlug: slug,
        environmentSlug: envSlug,
        ...(appSlug ? { appSlug } : {}),
        requiredRole: 'editor'
      })
    } catch (error) {
      if (error.code === 'forbidden') throw 'forbidden'
      throw { notFound: '/login' }
    }
    const { project, environment, app, actor } = resolved
    const appRunning = app && app.status === 'running'

    let modelMeta = null
    let assocOptions = {}
    let error = null

    if (appRunning) {
      try {
        const loaded = await sails.helpers.bridge.loadResource.with({
          containerName: app.containerName,
          environmentId: environment.id,
          modelIdentity,
          action: 'create',
          actor
        })
        modelMeta = loaded.resource
        const authorizedResources = {
          [modelMeta.identity]: modelMeta
        }
        for (const relationship of Object.values(
          modelMeta.relationships || {}
        )) {
          if (
            relationship.type !== 'model' ||
            !modelMeta.create.includes(relationship.alias)
          ) {
            continue
          }
          try {
            const related = await sails.helpers.bridge.loadResource.with({
              containerName: app.containerName,
              environmentId: environment.id,
              modelIdentity: relationship.resource,
              action: 'viewAny',
              actor
            })
            authorizedResources[relationship.resource] = related.resource
          } catch (relationshipAuthorizationError) {
            delete authorizedResources[relationship.resource]
            modelMeta.create = modelMeta.create.filter(
              (field) => field !== relationship.alias
            )
            modelMeta.relationships[relationship.alias].show = false
          }
        }
        assocOptions = await sails.helpers.bridge.loadAssociationOptions.with({
          containerName: app.containerName,
          resources: authorizedResources,
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
        app: { id: app.id, name: app.name, slug: app.slug },
        appScoped: Boolean(appSlug),
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
