/**
 * get-active-deployments.js
 *
 * Returns any currently active (pending, building, deploying) deployments
 * for the user's team.
 */

module.exports = {
  friendlyName: 'Get active deployments',

  description: 'Get all currently active deployments for the user\'s team.',

  exits: {
    success: {
      statusCode: 200
    }
  },

  fn: async function () {
    const user = await User.findOne({ id: this.req.session.userId }).populate('team')
    if (!user) return { deployments: [] }

    // Get all projects for the user's team
    const projects = await Project.find({ team: user.team.id })
    const projectIds = projects.map(p => p.id)

    if (projectIds.length === 0) return { deployments: [] }

    // Get all environments for these projects
    const environments = await Environment.find({ project: projectIds })
    const environmentIds = environments.map(e => e.id)

    if (environmentIds.length === 0) return { deployments: [] }

    // Find active deployments
    const activeDeployments = await Deployment.find({
      environment: environmentIds,
      status: ['pending', 'building', 'pushing', 'deploying']
    }).sort('createdAt DESC')

    // Get all apps for these environments (for app name enrichment)
    const apps = await App.find({ environment: environmentIds })

    // Enrich with project/environment/app info
    const enriched = []
    for (const deployment of activeDeployments) {
      const env = environments.find(e => e.id === deployment.environment)
      const proj = projects.find(p => p.id === env?.project)

      if (env && proj) {
        // Find the app for this deployment (or fall back to default app)
        let app = deployment.app ? apps.find(a => a.id === deployment.app) : null
        if (!app) {
          app = apps.find(a => a.environment === env.id && a.isDefault) || apps.find(a => a.environment === env.id)
        }

        enriched.push({
          id: deployment.id,
          status: deployment.status,
          gitBranch: deployment.gitBranch,
          gitCommit: deployment.gitCommit ? deployment.gitCommit.slice(0, 7) : null,
          startedAt: deployment.startedAt,
          project: {
            id: proj.id,
            name: proj.name,
            slug: proj.slug
          },
          environment: {
            id: env.id,
            name: env.name,
            slug: env.slug
          },
          app: app ? { id: app.id, name: app.name, slug: app.slug } : null
        })
      }
    }

    return { deployments: enriched }
  }
}
