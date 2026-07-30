module.exports = {
  friendlyName: 'View helm',

  description: 'Display the Helm REPL page for an environment.',

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
      description: 'App slug'
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

  fn: async function ({ slug, envSlug, appSlug }) {
    const user = await User.findOne({ id: this.req.session.userId }).populate(
      'team'
    )

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

    let app = appSlug
      ? await App.findOne({ environment: environment.id, slug: appSlug })
      : (await App.findOne({
          environment: environment.id,
          isDefault: true
        })) || (await App.findOne({ environment: environment.id }))
    if (appSlug && !app) {
      throw {
        notFound: `/projects/${slug}/environments/${envSlug}`
      }
    }
    if (app)
      app = await App.findOne({ id: app.id }).populate('currentDeployment')
    const target = app
      ? sails.helpers.helm.describeTarget({
          user,
          project,
          environment,
          app
        })
      : null

    return {
      page: 'projects/helm',
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
          isProduction: environment.isProduction
        },
        app: app
          ? {
              id: app.id,
              name: app.name,
              slug: app.slug,
              status: app.status
            }
          : null,
        appStatus: app ? app.status : null,
        target: target ? publicTarget(target) : null,
        writeArmTtlSeconds: Math.ceil(
          sails.config.custom.helm.writeArmTtlMs / 1000
        )
      }
    }
  }
}

function publicTarget(target) {
  const { fingerprint, ...safeTarget } = target
  return safeTarget
}
