module.exports = {
  friendlyName: 'View dashboard',

  description: 'Display "Dashboard" page.',

  exits: {
    success: {
      responseType: 'inertia'
    }
  },

  fn: async function () {
    // Get the logged-in user with their team
    const user = await User.forRequest(this.req, { populateTeam: true })

    // Fetch projects for the user's team
    let projects = []
    if (user && user.team) {
      const rawProjects = await Project.find({ team: user.team.id })
        .sort('createdAt DESC')
        .populate('environments')

      // Read only this team's apps once; keep status live without one query
      // (or two when there is no default app) for every environment.
      const environmentIds = rawProjects.flatMap((project) =>
        (project.environments || []).map((environment) => environment.id)
      )
      const apps = environmentIds.length
        ? await App.find({ environment: environmentIds })
            .select(['environment', 'isDefault', 'status'])
            .sort('id ASC')
        : []
      const appByEnvironment = new Map()
      for (const app of apps) {
        const selected = appByEnvironment.get(app.environment)
        if (!selected || (!selected.isDefault && app.isDefault)) {
          appByEnvironment.set(app.environment, app)
        }
      }

      projects = rawProjects.map((project) => {
        let status = 'no_deployments'
        let runningCount = 0

        for (const env of project.environments || []) {
          const app = appByEnvironment.get(env.id)
          if (app) {
            if (app.status === 'running') {
              runningCount++
              status = 'running'
            } else if (
              app.status === 'building' ||
              app.status === 'deploying'
            ) {
              status = app.status
            } else if (status === 'no_deployments' && app.status) {
              status = app.status
            }
          }
        }

        return {
          ...project,
          status,
          runningCount
        }
      })
    }

    return {
      page: 'dashboard/index',
      props: {
        projects
      }
    }
  }
}
