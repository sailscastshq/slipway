/**
 * stream-active-deployments.js
 *
 * @description :: SSE endpoint that streams active deployment changes.
 *                 Replaces polling of GET /api/v1/deployments/active.
 */

module.exports = {
  friendlyName: 'Stream active deployments',

  description: 'Server-Sent Events stream for active deployment discovery.',

  exits: {
    success: {
      description: 'SSE stream started.'
    }
  },

  fn: async function () {
    const req = this.req
    const res = this.res

    const user = await User.findOne({ id: req.session.userId }).populate('team')
    if (!user) {
      const stream = res.sse()
      stream.send({ deployments: [] })
      stream.close()
      return
    }

    const teamId = user.team.id

    const stream = res.sse()

    // Send initial state immediately
    const initial = await fetchActiveDeployments(teamId)
    stream.send({ deployments: initial })

    // Track the last set of deployment IDs to detect changes
    let lastIds = initial
      .map((d) => d.id)
      .sort()
      .join(',')

    const checkInterval = setInterval(async () => {
      try {
        const current = await fetchActiveDeployments(teamId)
        const currentIds = current
          .map((d) => d.id)
          .sort()
          .join(',')

        if (currentIds !== lastIds) {
          lastIds = currentIds
          stream.send({ deployments: current })
        }
      } catch (err) {
        sails.log.error('Active deployments SSE error:', err)
      }
    }, 5000)

    stream.onClose(() => {
      clearInterval(checkInterval)
    })

    return stream.wait()
  }
}

async function fetchActiveDeployments(teamId) {
  const projects = await Project.find({ team: teamId })
  const projectIds = projects.map((p) => p.id)
  if (projectIds.length === 0) return []

  const environments = await Environment.find({ project: projectIds })
  const environmentIds = environments.map((e) => e.id)
  if (environmentIds.length === 0) return []

  const activeDeployments = await Deployment.find({
    environment: environmentIds,
    status: ['pending', 'building', 'pushing', 'deploying']
  }).sort('createdAt DESC')

  if (activeDeployments.length === 0) return []

  const apps = await App.find({ environment: environmentIds })

  const enriched = []
  for (const deployment of activeDeployments) {
    const env = environments.find((e) => e.id === deployment.environment)
    const proj = projects.find((p) => p.id === env?.project)

    if (env && proj) {
      let app = deployment.app
        ? apps.find((a) => a.id === deployment.app)
        : null
      if (!app) {
        app =
          apps.find((a) => a.environment === env.id && a.isDefault) ||
          apps.find((a) => a.environment === env.id)
      }

      enriched.push({
        id: deployment.id,
        status: deployment.status,
        gitBranch: deployment.gitBranch,
        gitCommit: deployment.gitCommit
          ? deployment.gitCommit.slice(0, 7)
          : null,
        startedAt: deployment.startedAt,
        project: { id: proj.id, name: proj.name, slug: proj.slug },
        environment: { id: env.id, name: env.name, slug: env.slug },
        app: app ? { id: app.id, name: app.name, slug: app.slug } : null
      })
    }
  }

  return enriched
}
