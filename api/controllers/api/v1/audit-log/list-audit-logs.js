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
      statusCode: 200
    },
    forbidden: {
      statusCode: 403
    }
  },

  fn: async function ({ page, limit, q, group }) {
    const user = await User.findOne({ id: this.req.session.userId })
    if (!['owner', 'admin'].includes(user.teamRole)) throw 'forbidden'

    this.res.set('Cache-Control', 'private, no-store')
    return sails.helpers.audit.listTeamEvents(
      String(user.team),
      page,
      limit,
      q,
      group
    )
  }
}
