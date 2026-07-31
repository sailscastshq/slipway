module.exports = {
  friendlyName: 'Present release flag',

  description: 'Return the public boolean release flag contract.',

  sync: true,

  inputs: {
    flag: { type: 'ref', required: true }
  },

  exits: {
    success: { outputType: 'ref' }
  },

  fn: function ({ flag }) {
    return {
      id: flag.id,
      key: flag.key,
      description: flag.description || null,
      enabled: flag.enabled === true,
      rolloutPercentage: Number(flag.rolloutPercentage || 0),
      targets: Array.isArray(flag.targets) ? flag.targets : [],
      version: Number(flag.version || 1),
      changedByName: flag.changedByName || null,
      updatedAt: flag.updatedAt,
      createdAt: flag.createdAt
    }
  }
}
