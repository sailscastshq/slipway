module.exports = {
  friendlyName: 'List audit logs',

  description: 'Retrieve paginated audit log entries for the current team.',

  inputs: {
    page: {
      type: 'number',
      defaultsTo: 1,
      min: 1
    },
    limit: {
      type: 'number',
      defaultsTo: 50,
      min: 1,
      max: 100
    }
  },

  exits: {
    success: {
      statusCode: 200
    }
  },

  fn: async function ({ page, limit }) {
    const user = await User.findOne({ id: this.req.session.userId })
    const skip = (page - 1) * limit

    const [logs, totalCount] = await Promise.all([
      AuditLog.find({ team: user.team })
        .sort('createdAt DESC')
        .skip(skip)
        .limit(limit)
        .populate('user'),
      AuditLog.count({ team: user.team })
    ])

    return {
      logs: logs.map(log => ({
        id: log.id,
        action: log.action,
        resourceType: log.resourceType,
        resourceId: log.resourceId,
        details: log.details,
        ipAddress: log.ipAddress,
        userName: log.user ? log.user.fullName || log.user.email : 'System',
        createdAt: log.createdAt
      })),
      pagination: {
        page,
        perPage: limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit)
      }
    }
  }
}
