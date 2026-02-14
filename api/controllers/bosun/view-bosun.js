/**
 * view-bosun.js
 *
 * Bosun self-administration dashboard — shows system overview stats,
 * entity counts, database sizes, and process information.
 */

const fs = require('fs')
const path = require('path')

module.exports = {
  friendlyName: 'View Bosun',

  description: 'Display the Bosun self-administration dashboard.',

  exits: {
    success: {
      responseType: 'inertia'
    },
    notFound: {
      responseType: 'redirect'
    }
  },

  fn: async function () {
    const user = await User.findOne({ id: this.req.session.userId }).populate('team')
    if (!user) {
      throw { notFound: '/login' }
    }

    // Gather IDs for scoped counts
    const projects = await Project.find({ team: user.team.id }).select(['id'])
    const projectIds = projects.map(p => p.id)
    const environments = projectIds.length > 0
      ? await Environment.find({ project: projectIds }).select(['id'])
      : []
    const environmentIds = environments.map(e => e.id)

    // Entity counts
    const [appCount, serviceCount, deploymentCount, backupCount, userCount] = await Promise.all([
      environmentIds.length > 0 ? App.count({ environment: environmentIds }) : 0,
      environmentIds.length > 0 ? Service.count({ environment: environmentIds }) : 0,
      Deployment.count(),
      Backup.count(),
      User.count()
    ])

    // Database file sizes
    const dbFiles = {
      app: path.resolve(sails.config.appPath, 'db/app.db'),
      observability: path.resolve(sails.config.appPath, 'db/observability.db'),
      cache: path.resolve(sails.config.appPath, 'db/stash.db')
    }

    const databases = {}
    for (const [name, filePath] of Object.entries(dbFiles)) {
      try {
        const stats = fs.statSync(filePath)
        databases[name] = { path: filePath, sizeBytes: stats.size }
      } catch {
        databases[name] = { path: filePath, sizeBytes: 0 }
      }
    }

    // Process info
    const memUsage = process.memoryUsage()
    const processInfo = {
      uptime: process.uptime(),
      memoryUsage: {
        rss: memUsage.rss,
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal
      },
      nodeVersion: process.version,
      platform: process.platform,
      pid: process.pid
    }

    // Slipway version
    let version = 'unknown'
    try {
      const pkg = require(path.resolve(sails.config.appPath, 'package.json'))
      version = pkg.version
    } catch { /* ignore */ }

    // Instance environment variables (from process.env + saved overrides)
    const knownKeys = [
      'SESSION_SECRET', 'DATA_ENCRYPTION_KEY', 'SLIPWAY_URL',
      'NODE_ENV', 'PORT', 'SLIPWAY_SSL'
    ]
    const instanceEnvVars = {}
    for (const key of knownKeys) {
      if (process.env[key] !== undefined) {
        instanceEnvVars[key] = process.env[key]
      }
    }
    // Merge with user-saved custom vars
    const savedEnvJson = await sails.helpers.setting.get('instanceEnvVars', '{}')
    try {
      Object.assign(instanceEnvVars, JSON.parse(savedEnvJson))
    } catch { /* ignore */ }

    return {
      page: 'bosun/index',
      props: {
        stats: {
          projects: projectIds.length,
          environments: environmentIds.length,
          apps: appCount,
          services: serviceCount,
          deployments: deploymentCount,
          backups: backupCount,
          users: userCount
        },
        databases,
        processInfo,
        version,
        instanceEnvVars
      }
    }
  }
}
