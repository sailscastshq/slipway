module.exports = {
  friendlyName: 'View project',

  description: 'Display project detail page with environments and deployments.',

  inputs: {
    slug: {
      type: 'string',
      required: true,
      description: 'Project slug'
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

  fn: async function ({ slug }) {
    const user = await User.findOne({ id: this.req.session.userId }).populate('team')

    const project = await Project.findOne({ slug, team: user.team.id })
      .populate('environments')

    if (!project) {
      throw { notFound: '/' }
    }

    // For each environment, get app status and recent deployments
    const environments = await Promise.all(
      project.environments.map(async (env) => {
        const app = await App.findOne({ environment: env.id })

        // Fix stale running deployments
        if (app && app.currentDeployment) {
          await Deployment.update({
            environment: env.id,
            status: 'running',
            id: { '!=': app.currentDeployment }
          }).set({ status: 'stopped' })
        }

        const deployments = await Deployment.find({ environment: env.id })
          .sort('id DESC')
          .limit(5)
          .populate('triggeredBy')

        // Running deployment always first
        deployments.sort((a, b) => {
          if (a.status === 'running' && b.status !== 'running') return -1
          if (a.status !== 'running' && b.status === 'running') return 1
          return 0
        })

        const fullDomain = await Environment.getFullDomain(env.id)

        return {
          ...env,
          app: app || null,
          deployments,
          fullDomain
        }
      })
    )

    // Get recent deployments across all environments
    // First get any running/building/deploying deployments to ensure they're included
    const activeDeployments = await Deployment.find({
      environment: project.environments.map(e => e.id),
      status: ['running', 'building', 'deploying']
    })
      .populate('triggeredBy')
      .populate('environment')

    // Then get recent deployments by date
    const latestDeployments = await Deployment.find({
      environment: project.environments.map(e => e.id)
    })
      .sort('createdAt DESC')
      .limit(10)
      .populate('triggeredBy')
      .populate('environment')

    // Merge and dedupe, prioritizing active deployments
    const seenIds = new Set()
    const recentDeployments = []

    // Add active deployments first
    for (const dep of activeDeployments) {
      if (!seenIds.has(dep.id)) {
        seenIds.add(dep.id)
        recentDeployments.push(dep)
      }
    }

    // Add latest deployments (sorted by date, newest first)
    for (const dep of latestDeployments) {
      if (!seenIds.has(dep.id)) {
        seenIds.add(dep.id)
        recentDeployments.push(dep)
      }
    }

    // Keep only top 5
    recentDeployments.splice(5)

    return {
      page: 'projects/show',
      props: {
        project,
        environments,
        recentDeployments
      }
    }
  }
}
