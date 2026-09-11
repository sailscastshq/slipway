const tokens = require('../../lib/bridge-action-context-token')
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
    conditionToken: { type: 'string', maxLength: 512 },
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
    const fail = (reason, message, diagnostic) => {
      sails.log.warn('[bridge.action.context]', {
        reason,
        containerName,
        resource: resource.identity,
        action: action.name,
        recordId,
        ...(diagnostic ? { diagnostic: String(diagnostic).slice(0, 1000) } : {})
      })
      const error = new Error(message)
      error.code = `BRIDGE_ACTION_CONTEXT_${reason.toUpperCase()}`
      throw error
    }
    const fields = conditions.fields(action)
    if (!fields.length && !conditionToken) return { action }
    conditions.validate(action, resource)
    if (resource.actions.view !== true)
      fail('forbidden', 'You no longer have permission to view this record.')
    const secret = sails.config.session?.secret
    if (typeof secret !== 'string' || secret.length < 16)
      fail(
        'unavailable',
        'Could not verify this action. Try again.',
        'Session signing secret is unavailable.'
      )
    const binding = tokens.bindingFor({
      containerName,
      resource,
      recordId,
      actor
    })
    let original
    if (verify) {
      original = tokens.read(conditionToken, secret)
      if (!original)
        fail(
          'invalid_token',
          'Could not verify this dialog. Reopen the action; your message has been kept.'
        )
      if (original.binding !== tokens.hash(binding))
        fail(
          'binding_changed',
          'This dialog belongs to a different record or session. Reopen the action.'
        )
      if (original.action !== tokens.hash(action))
        fail(
          'configuration_changed',
          'This action’s configuration changed. Reopen it to review the updated fields.'
        )
    }
    const code = `
      const model = sails.models[${JSON.stringify(resource.identity)}];
      const record = await model.findOne(${JSON.stringify({
        [resource.primaryKey]: recordId
      })}).select(${JSON.stringify(fields)});
      return { conditionRecord: record || null };
    `
    let result
    try {
      result = await sails.helpers.bridge.executeInContainer(
        containerName,
        await sails.helpers.bridge.buildSailsWrapper(code)
      )
    } catch (error) {
      fail(
        'read_failed',
        'Could not load the record to check this action. Try again; nothing was sent.',
        error.message
      )
    }
    if (!result.success)
      fail(
        'read_failed',
        'Could not load the record to check this action. Try again; nothing was sent.',
        result.error
      )
    let record
    try {
      record = JSON.parse(result.output).conditionRecord
    } catch {
      fail(
        'invalid_response',
        'Could not read the record’s current state. Try again; nothing was sent.'
      )
    }
    if (!record)
      fail('record_missing', 'This record no longer exists. Nothing was sent.')
    if (
      fields.some(
        (field) => !Object.prototype.hasOwnProperty.call(record, field)
      )
    )
      fail(
        'fields_missing',
        'Could not read all fields needed for this action. Refresh the record and try again.'
      )
    const state = fields.map((field) => record[field])
    if (verify && original.state !== tokens.hash(state))
      fail('state_changed', conditions.changedMessage(resource, fields))
    if (!conditions.matches(action.visibleWhen, record))
      fail(
        'not_visible',
        'This action is not available for the record’s current state. Refresh the record to review it.'
      )
    return {
      action: conditions.effective(action, record),
      conditionToken: verify
        ? conditionToken
        : tokens.create(binding, action, state, secret),
      conditionState: { fields, values: state }
    }
  }
}
