module.exports = {
  friendlyName: 'View audit log',

  description: 'Display the audit log page with pagination.',

  inputs: {
    page: {
      type: 'number',
      defaultsTo: 1,
      min: 1
    }
  },

  exits: {
    success: {
      responseType: 'inertia'
    }
  },

  fn: async function ({ page }) {
    const perPage = 50
    const skip = (page - 1) * perPage

    const user = await User.findOne({ id: this.req.session.userId })

    const [logs, totalCount] = await Promise.all([
      AuditLog.find({ team: user.team })
        .sort('createdAt DESC')
        .skip(skip)
        .limit(perPage)
        .populate('user'),
      AuditLog.count({ team: user.team })
    ])

    // Sanitize user data for the frontend
    const sanitizedLogs = logs.map((log) => ({
      id: log.id,
      action: log.action,
      resourceType: log.resourceType,
      resourceId: log.resourceId,
      details: log.details,
      ipAddress: log.ipAddress,
      userName: log.user ? log.user.fullName || log.user.email : 'System',
      createdAt: log.createdAt
    }))

    return {
      page: 'settings/audit-log',
      props: {
        logs: sanitizedLogs,
        pagination: {
          page,
          perPage,
          totalCount,
          totalPages: Math.ceil(totalCount / perPage)
        }
      }
    }
  }
}
