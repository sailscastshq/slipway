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
    const user = await User.findOne({ id: this.req.session.userId }).populate(
      'team'
    )

    // Fetch projects for the user's team
    let projects = []
    if (user && user.team) {
      const rawProjects = await Project.find({ team: user.team.id })
        .sort('createdAt DESC')
        .populate('environments')

      // For each project, get the status from its environments/apps
      projects = await Promise.all(rawProjects.map(async (project) => {
        let status = 'no_deployments'
        let runningCount = 0

        for (const env of project.environments || []) {
          const app = await App.findOne({ environment: env.id })
          if (app) {
            if (app.status === 'running') {
              runningCount++
              status = 'running'
            } else if (app.status === 'building' || app.status === 'deploying') {
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
      }))
    }

    return {
      page: 'dashboard/index',
      props: {
        projects
      }
    }
  }
}
