module.exports = {
  friendlyName: 'View audit log',

  description: 'Display the audit log page with pagination.',

  inputs: {
    page: {
      type: 'number',
      defaultsTo: 1,
      min: 1
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
      responseType: 'inertia'
    },
    forbidden: {
      responseType: 'redirect'
    }
  },

  fn: async function ({ page, q, group }) {
    const perPage = 50
    const user = await User.findOne({ id: this.req.session.userId })
    if (!['owner', 'admin'].includes(user.teamRole)) {
      throw { forbidden: '/settings' }
    }

    const result = await sails.helpers.audit.listTeamEvents(
      String(user.team),
      page,
      perPage,
      q,
      group
    )

    return {
      page: 'settings/audit-log',
      props: {
        ...result,
        helmAuditRetentionDays: Math.round(
          sails.config.custom.helm.auditRetentionMs / (24 * 60 * 60 * 1000)
        )
      }
    }
  }
}
