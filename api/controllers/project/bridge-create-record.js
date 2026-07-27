module.exports = {
  friendlyName: 'Bridge create record',

  description: 'Create a new record in a Waterline model.',

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
    },
    values: {
      type: 'ref',
      required: true,
      description: 'Record values to create'
    }
  },

  exits: {
    success: {
      responseType: 'redirect'
    },
    notFound: {
      responseType: 'redirect'
    },
    badRequest: {
      responseType: 'badRequest'
    }
  },

  fn: async function ({ slug, envSlug, modelIdentity, values }) {
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
    if (!app || app.status !== 'running') {
      throw { badRequest: { error: 'App is not running' } }
    }

    let loaded
    let allowedValues
    try {
      const actor = await sails.helpers.bridge.buildActor.with({
        user,
        project,
        environment
      })
      loaded = await sails.helpers.bridge.loadResource.with({
        containerName: app.containerName,
        environmentId: environment.id,
        modelIdentity,
        action: 'create',
        actor
      })
      allowedValues = await sails.helpers.bridge.allowResourceValues.with({
        values,
        resource: loaded.resource,
        surface: 'create',
        uploadContext: {
          actorId: user.id,
          projectId: project.id,
          environmentId: environment.id
        }
      })
      await sails.helpers.bridge.authorizeRelationshipValues.with({
        containerName: app.containerName,
        environmentId: environment.id,
        resource: loaded.resource,
        actor,
        values: allowedValues
      })
    } catch (error) {
      throw { badRequest: toBadRequest(error) }
    }

    try {
      const record = await sails.helpers.bridge.createRecord.with({
        containerName: app.containerName,
        resource: loaded.resource,
        values: allowedValues
      })
      const recordId = record?.[loaded.resource.primaryKey]

      const envPath = envSlug !== 'production' ? `/environments/${envSlug}` : ''
      if (recordId !== undefined && recordId !== null) {
        return `/projects/${slug}${envPath}/bridge/${
          loaded.resource.identity
        }/${encodeURIComponent(String(recordId))}`
      }
      return `/projects/${slug}${envPath}/bridge/${loaded.resource.identity}`
    } catch (error) {
      throw { badRequest: toBadRequest(error) }
    }
  }
}

function toBadRequest(error) {
  if (!error?.fieldErrors) return { error: error.message }
  return {
    error: error.message,
    problems: Object.entries(error.fieldErrors).map(([field, message]) => ({
      [field]: message
    }))
  }
}
