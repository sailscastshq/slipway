module.exports = {
  friendlyName: 'Resolve action record fields',
  description:
    'Resolve saved-record visibility while retaining reactive form conditions.',
  sync: true,
  inputs: {
    action: { type: 'ref' },
    record: { type: 'ref' }
  },
  exits: { success: { outputType: 'ref' } },
  fn: function ({ action, record }) {
    return {
      ...action,
      fields: Object.fromEntries(
        Object.entries(action.fields || {}).filter(([, field]) =>
          sails.helpers.bridge.matchesActionConditions.with({
            condition: field.visibleWhen,
            record,
            scope: 'record'
          })
        )
      )
    }
  }
}
