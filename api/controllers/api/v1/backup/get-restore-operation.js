module.exports = {
  friendlyName: 'Get restore operation',
  inputs: { operationId: { type: 'number', required: true } },
  exits: { notFound: { statusCode: 404 }, forbidden: { statusCode: 403 } },
  fn: async function ({ operationId }) {
    const operation = await RestoreOperation.findOne({ id: operationId })
    if (!operation) throw 'notFound'
    const user = await User.forRequest(this.req)
    if (operation.team !== user.team) throw 'forbidden'
    return { operation }
  }
}
