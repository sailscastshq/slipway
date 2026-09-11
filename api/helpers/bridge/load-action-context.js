const crypto = require('node:crypto')
const conditions = require('../../lib/bridge-action-conditions')

module.exports = {
  friendlyName: 'Load Bridge action context',
  description:
    'Resolve visible fields from a saved record and bind the dialog to that state.',
  inputs: {
    containerName: { type: 'string', required: true },
    resource: { type: 'ref', required: true },
    action: { type: 'ref', required: true },
    actor: { type: 'ref', required: true },
    recordId: { type: 'ref' },
    conditionToken: { type: 'string', maxLength: 128 },
    verify: { type: 'boolean', defaultsTo: false }
  },
  fn: async function ({
    containerName,
    resource,
    action,
    actor,
    recordId,
    conditionToken,
    verify
  }) {
    const fields = conditions.fields(action)
    if (!fields.length) {
      if (verify && conditionToken) throw stale()
      return { action }
    }
    conditions.validate(action, resource)
    if (resource.actions.view !== true) throw stale()
    const code = `
      const model = sails.models[${JSON.stringify(resource.identity)}];
      const record = await model.findOne(${JSON.stringify({
        [resource.primaryKey]: recordId
      })}).select(${JSON.stringify(fields)});
      return { conditionRecord: record || null };
    `
    const result = await sails.helpers.bridge.executeInContainer(
      containerName,
      await sails.helpers.bridge.buildSailsWrapper(code)
    )
    if (!result.success) throw stale()
    let record
    try {
      record = JSON.parse(result.output).conditionRecord
    } catch {
      throw stale()
    }
    if (
      !record ||
      fields.some(
        (field) => !Object.prototype.hasOwnProperty.call(record, field)
      ) ||
      !conditions.matches(action.visibleWhen, record)
    )
      throw stale()
    const state = fields.map((field) => record[field])
    const expires = verify
      ? Number(conditionToken?.split('.')[0])
      : Date.now() + 15 * 60 * 1000
    if (
      !Number.isSafeInteger(expires) ||
      expires < Date.now() ||
      expires > Date.now() + 15 * 60 * 1000
    )
      throw stale()
    const secret = sails.config.session?.secret
    if (typeof secret !== 'string' || secret.length < 16)
      throw new Error('Bridge action context requires a session secret.')
    const signature = crypto
      .createHmac('sha256', secret)
      .update(
        JSON.stringify({
          containerName,
          resource: resource.identity,
          recordId,
          actor,
          action,
          state,
          expires
        })
      )
      .digest('hex')
    const token = `${expires}.${signature}`
    if (
      verify &&
      (typeof conditionToken !== 'string' ||
        Buffer.byteLength(conditionToken) !== Buffer.byteLength(token) ||
        !crypto.timingSafeEqual(
          Buffer.from(conditionToken),
          Buffer.from(token)
        ))
    )
      throw stale()
    return {
      action: conditions.effective(action, record),
      conditionToken: token,
      conditionState: { fields, values: state }
    }
  }
}
function stale() {
  const error = new Error(
    'This action is no longer current. Reopen it and try again.'
  )
  error.code = 'BRIDGE_ACTION_STALE'
  return error
}
