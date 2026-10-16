module.exports = {
  friendlyName: 'View project',

  description: 'Display project detail page with environments and deployments.',

  inputs: {
    slug: {
      type: 'string',
      required: true,
      description: 'Project slug'
    },
    deploymentStatus: {
      type: 'string'
    },
    deploymentEnvironment: {
      type: 'string'
    },
    deploymentApp: {
      type: 'string'
    },
    deploymentSource: {
      type: 'string'
    },
    deploymentCursor: {
      type: 'string'
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

  fn: async function ({
    slug,
    deploymentStatus,
    deploymentEnvironment,
    deploymentApp,
    deploymentSource,
    deploymentCursor
  }) {
    const user = await User.forRequest(this.req, { populateTeam: true })

    const project = await Project.findOne({
      slug,
      team: user.team.id
    }).populate('environments')

    if (!project) {
      throw { notFound: '/' }
    }

    const allApps = await App.find({
      environment: project.environments.map((environment) => environment.id)
    })

    // Reuse the authorized project/environment records. Resolving by ID here
    // would reload each environment and its project just to build a hostname.
    const wildcardDomain = project.environments.length
      ? await sails.helpers.setting.get('wildcardDomain')
      : null
    const environments = await Promise.all(
      project.environments.map(async (env) => {
        const apps = allApps.filter(
          (candidate) => candidate.environment === env.id
        )
        const app = apps.find((a) => a.isDefault) || apps[0] || null

        const { fullDomain } = await Environment.resolveDomains(env, {
          project,
          wildcardDomain,
          slipwayDomain: sails.config.custom.slipwayDomain
        })

        return {
          ...env,
          app: app || null,
          apps,
          fullDomain
        }
      })
    )

    const productionEnvironmentIds = new Set(
      project.environments
        .filter((environment) => environment.isProduction)
        .map((environment) => environment.id)
    )
    const deploymentHistory = await sails.helpers.deployment.getHistory.with({
      projectSlug: project.slug,
      environments: project.environments,
      apps: allApps,
      currentApps: allApps.filter((app) =>
        productionEnvironmentIds.has(app.environment)
      ),
      filters: {
        status: deploymentStatus,
        environment: deploymentEnvironment,
        app: deploymentApp,
        source: deploymentSource
      },
      cursor: deploymentCursor || null
    })

    return {
      page: 'projects/show',
      props: {
        project,
        environments,
        deploymentHistory
      }
    }
  }
}
