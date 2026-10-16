module.exports = {
  friendlyName: 'Matches action conditions',
  description:
    'Compare normalized conditions without coercion, optionally within one scope.',
  sync: true,
  inputs: {
    condition: { type: 'ref' },
    record: { type: 'ref' },
    form: { type: 'ref' },
    scope: { type: 'ref' }
  },
  exits: { success: { outputType: 'boolean' } },
  fn: function ({ condition, record, form, scope }) {
    return Object.entries(condition || {}).every(([path, expected]) => {
      const [source, field] = path.split('.')
      if (scope && source !== scope) return true
      const values = source === 'form' ? form : record
      if (!values || !Object.prototype.hasOwnProperty.call(values, field))
        return false
      return expected && typeof expected === 'object'
        ? expected.in.includes(values[field])
        : values[field] === expected
    })
  }
}
