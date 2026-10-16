module.exports = {
  friendlyName: 'Describe action condition change',
  description:
    'Describe changed record conditions without exposing private record values.',
  sync: true,
  inputs: {
    resource: { type: 'ref' },
    fields: { type: 'ref' }
  },
  exits: { success: { outputType: 'string' } },
  fn: function ({ resource, fields }) {
    const subject = String(resource.singularLabel || 'record').toLowerCase()
    return fields.length === 1 && fields[0] === 'status'
      ? `This ${subject}'s status changed. Reopen the action to review it before sending.`
      : `This ${subject}'s action fields changed. Reopen the action to review them before sending.`
  }
}
