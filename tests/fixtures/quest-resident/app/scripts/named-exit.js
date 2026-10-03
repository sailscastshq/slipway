module.exports = {
  friendlyName: 'Named business exit',
  exits: { nothingToDo: { outputType: 'json' } },
  fn: async function (_inputs, exits) {
    return exits.nothingToDo({ processed: 0, pending: 5 })
  }
}
