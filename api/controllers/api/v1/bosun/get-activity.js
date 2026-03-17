/**
 * get-activity.js
 *
 * Returns recent activity for the Bosun dashboard — deployments,
 * backups, and audit log entries combined into a single feed.
 */

module.exports = {
  friendlyName: 'Get Bosun activity',

  description: 'Get recent activity feed for the Bosun dashboard.',

  inputs: {
    page: {
      type: 'number',
      defaultsTo: 1,
      min: 1
    },
    limit: {
      type: 'number',
      defaultsTo: 30,
      min: 1,
      max: 100
    },
    type: {
      type: 'string',
      isIn: ['all', 'deployments', 'backups', 'audit'],
      defaultsTo: 'all'
    }
  },

  exits: {
    success: {
      statusCode: 200
    },
    notFound: {
      statusCode: 404
    }
  },

  fn: async function ({ page, limit, type }) {
    const user = await User.findOne({ id: this.req.session.userId }).populate(
      'team'
    )
    if (!user) {
      throw 'notFound'
    }

    const skip = (page - 1) * limit
    const activities = []

    // Fetch deployments
    if (type === 'all' || type === 'deployments') {
      const deployments = await Deployment.find()
        .sort('createdAt DESC')
        .limit(type === 'deployments' ? limit : Math.ceil(limit / 3))
        .skip(type === 'deployments' ? skip : 0)
        .populate('environment')
        .populate('triggeredBy')
        .populate('app')

      for (const d of deployments) {
        let projectName = null
        if (d.environment) {
          const project = await Project.findOne({ id: d.environment.project })
          projectName = project?.name
        }

        activities.push({
          id: `deploy-${d.id}`,
          type: 'deployment',
          action: d.status,
          description: `Deployment ${d.status}`,
          resource: d.app?.name || projectName || 'Unknown',
          resourceType: 'deployment',
          user: d.triggeredBy
            ? { fullName: d.triggeredBy.fullName, email: d.triggeredBy.email }
            : null,
          status: d.status,
          metadata: {
            gitBranch: d.gitBranch,
            gitCommit: d.gitCommit ? d.gitCommit.substring(0, 7) : null,
            triggerType: d.triggerType,
            environment: d.environment?.name,
            durationMs:
              d.startedAt && d.finishedAt ? d.finishedAt - d.startedAt : null
          },
          createdAt: d.createdAt
        })
      }
    }

    // Fetch backups
    if (type === 'all' || type === 'backups') {
      const backups = await Backup.find()
        .sort('createdAt DESC')
        .limit(type === 'backups' ? limit : Math.ceil(limit / 3))
        .skip(type === 'backups' ? skip : 0)
        .populate('service')
        .populate('triggeredBy')

      for (const b of backups) {
        activities.push({
          id: `backup-${b.id}`,
          type: 'backup',
          action: b.status,
          description: `Backup ${b.status}`,
          resource: b.service?.name || 'Unknown service',
          resourceType: 'backup',
          user: b.triggeredBy
            ? { fullName: b.triggeredBy.fullName, email: b.triggeredBy.email }
            : null,
          status: b.status,
          metadata: {
            sizeBytes: b.sizeBytes,
            durationMs: b.durationMs,
            backupType: b.type
          },
          createdAt: b.createdAt
        })
      }
    }

    // Fetch audit logs
    if (type === 'all' || type === 'audit') {
      const auditLogs = await AuditLog.find({ team: user.team.id })
        .sort('createdAt DESC')
        .limit(type === 'audit' ? limit : Math.ceil(limit / 3))
        .skip(type === 'audit' ? skip : 0)
        .populate('user')

      for (const log of auditLogs) {
        activities.push({
          id: `audit-${log.id}`,
          type: 'audit',
          action: log.action,
          description: log.action
            .replace(/\./g, ' ')
            .replace(/\b\w/g, (c) => c.toUpperCase()),
          resource: log.resourceType,
          resourceType: log.resourceType,
          user: log.user
            ? { fullName: log.user.fullName, email: log.user.email }
            : null,
          status: null,
          metadata: {
            ipAddress: log.ipAddress,
            details: log.details,
            resourceId: log.resourceId
          },
          createdAt: log.createdAt
        })
      }
    }

    // Sort combined feed by date (newest first)
    activities.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

    // Paginate the combined result for 'all' type
    const finalActivities =
      type === 'all' ? activities.slice(0, limit) : activities

    return {
      activities: finalActivities,
      page,
      limit
    }
  }
}
