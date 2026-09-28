const { getHelmCompletions } = require('../../../../lib/helm-completion-cache')
const expectedHelmRuntime = require('../../../../lib/helm-expected-runtime')

module.exports = {
  friendlyName: 'Get project Helm completions',

  description:
    'Return secret-free Sails completion metadata from the environment default app.',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true
    },
    environmentSlug: {
      type: 'string',
      required: true
    },
    appSlug: {
      type: 'string'
    }
  },

  exits: {
    success: {
      statusCode: 200
    },
    notFound: {
      statusCode: 404
    },
    forbidden: {
      statusCode: 403
    }
  },

  fn: async function ({ projectSlug, environmentSlug, appSlug }) {
    const user = await User.forRequest(this.req)
    const project = await Project.findOne({ slug: projectSlug }).populate(
      'team'
    )

    if (!project) throw 'notFound'
    if (project.team.id !== user.team) throw 'forbidden'

    const environment = await Environment.findOne({
      project: project.id,
      slug: environmentSlug
    })
    if (!environment) throw 'notFound'

    const app = appSlug
      ? await App.findOne({ environment: environment.id, slug: appSlug })
      : (await App.findOne({ environment: environment.id, isDefault: true })) ||
        (await App.findOne({ environment: environment.id }))

    if (appSlug && !app) throw 'notFound'

    this.res.set('Cache-Control', 'private, no-store')

    if (!app || app.status !== 'running' || !app.containerName) {
      return {
        available: false,
        version: 1,
        truncated: false,
        models: [],
        helpers: [],
        config: []
      }
    }

    try {
      const key = JSON.stringify([
        app.id,
        app.containerName,
        app.imageId,
        app.imageName,
        app.currentDeployment
      ])
      return await getHelmCompletions(key, () =>
        expectedHelmRuntime(app).then((runtime) =>
          sails.helpers.helm.getCompletions(app.containerName, runtime)
        )
      )
    } catch {
      return {
        available: false,
        version: 1,
        truncated: false,
        models: [],
        helpers: [],
        config: []
      }
    }
  }
}
