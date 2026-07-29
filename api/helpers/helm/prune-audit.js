module.exports = {
  friendlyName: 'Prune Helm audit',

  description:
    'Apply the configured age and per-team bounds to Helm audit events.',

  inputs: {
    teamId: {
      type: 'string',
      required: true
    },
    now: {
      type: 'number'
    }
  },

  fn: async function ({ teamId, now }) {
    now = now || Date.now()
    const retentionMs = sails.config.custom.helm.auditRetentionMs
    const maxEntries = sails.config.custom.helm.auditMaxEntriesPerTeam
    const criteria = {
      team: teamId,
      action: { startsWith: 'helm.' }
    }

    await AuditLog.destroy({
      ...criteria,
      createdAt: { '<': now - retentionMs }
    })

    const overflow = await AuditLog.find(criteria)
      .sort(['createdAt DESC', 'id DESC'])
      .skip(maxEntries)
      .limit(1000)
    if (overflow.length > 0) {
      await AuditLog.destroy({ id: overflow.map((event) => event.id) })
    }
  }
}
