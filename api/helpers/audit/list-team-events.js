module.exports = {
  friendlyName: 'List team audit events',

  description:
    'Return searchable, paginated audit events for one team without exposing protected user fields.',

  inputs: {
    teamId: {
      type: 'string',
      required: true
    },
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
    },
    q: {
      type: 'string',
      maxLength: 200
    },
    group: {
      type: 'string',
      isIn: ['all', 'helm'],
      defaultsTo: 'all'
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ teamId, page, limit, q, group }) {
    const search = (q || '').trim()
    const criteria = { team: teamId }
    if (group === 'helm') criteria.action = { startsWith: 'helm.' }

    if (search) {
      const [matchingUsers, matchingDetails] = await Promise.all([
        User.find({
          team: teamId,
          or: [
            { fullName: { contains: search } },
            { email: { contains: search } }
          ]
        }).select(['id']),
        findMatchingDetailIds(teamId, search)
      ])
      criteria.or = [
        { action: { contains: search } },
        { resourceType: { contains: search } },
        { resourceId: { contains: search } },
        { ipAddress: { contains: search } }
      ]
      if (matchingUsers.length > 0) {
        criteria.or.push({ user: matchingUsers.map((user) => user.id) })
      }
      if (matchingDetails.length > 0) {
        criteria.or.push({ id: matchingDetails })
      }
    }

    const skip = (page - 1) * limit
    const [logs, totalCount] = await Promise.all([
      AuditLog.find(criteria)
        .sort(['createdAt DESC', 'id DESC'])
        .skip(skip)
        .limit(limit)
        .populate('user'),
      AuditLog.count(criteria)
    ])

    return {
      logs: logs.map(serializeLog),
      filters: { q: search, group },
      pagination: {
        page,
        perPage: limit,
        totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / limit))
      }
    }
  }
}

function findMatchingDetailIds(teamId, search) {
  const database = sails.getDatastore().manager
  return database
    .prepare(
      `
        SELECT id
        FROM audit_logs
        WHERE team = ?
          AND details LIKE ?
        ORDER BY created_at DESC, id DESC
        LIMIT 1000
      `
    )
    .all(teamId, `%${search}%`)
    .map((row) => row.id)
}

function serializeLog(log) {
  return {
    id: log.id,
    action: log.action,
    resourceType: log.resourceType,
    resourceId: log.resourceId,
    details: log.details,
    ipAddress: log.ipAddress,
    userName: log.user ? log.user.fullName || log.user.email : 'System',
    userEmail: log.user ? log.user.email : null,
    createdAt: log.createdAt
  }
}
