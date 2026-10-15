module.exports = {
  friendlyName: 'Get action condition fields',
  description:
    'List saved-record fields needed to bind an action to its current state.',
  sync: true,
  inputs: {
    action: { type: 'ref' }
  },
  exits: { success: { outputType: 'ref' } },
  fn: function ({ action }) {
    return [
      ...new Set(
        [
          action.visibleWhen,
          ...Object.values(action.fields || {}).map(
            (field) => field.visibleWhen
          )
        ].flatMap((condition) =>
          Object.keys(condition || {})
            .filter((path) => path.startsWith('record.'))
            .map((path) => path.slice(7))
        )
      )
    ].sort()
  }
}
