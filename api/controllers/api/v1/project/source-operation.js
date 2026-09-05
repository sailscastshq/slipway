const operations = require('../../../../lib/source-operations')
module.exports = {
  friendlyName: 'Inspect source operation',
  inputs: { operationId: { type: 'number', required: true } },
  exits: { notFound: { statusCode: 404 }, forbidden: { statusCode: 403 } },
  fn: async function ({ operationId }) {
    const op = await SourceOperation.findOne({ id: operationId }).populate(
      'project'
    )
    if (!op?.project) throw 'notFound'
    const user = await User.forRequest(this.req)
    if (op.project.team !== user.team) throw 'forbidden'
    const result =
      this.req.method === 'DELETE' ? await operations.cancel(operationId) : op
    return { operation: operations.publicOperation(result) }
  }
}
