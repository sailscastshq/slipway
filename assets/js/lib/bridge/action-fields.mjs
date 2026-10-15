import { prepareBridgeFieldSubmission } from './fields.mjs'

// Saved-record conditions have already been resolved by the context endpoint.
export function visibleBridgeActionFields(action, values) {
  return Object.entries(action?.fields || {})
    .filter(([, attr]) =>
      Object.entries(attr.visibleWhen || {}).every(([path, expected]) => {
        if (!path.startsWith('form.')) return true
        const name = path.slice(5)
        if (!Object.hasOwn(values, name)) return false
        const value = prepareBridgeFieldSubmission({
          attribute: action.fields[name],
          value: values[name]
        }).value
        return expected && typeof expected === 'object'
          ? expected.in.includes(value)
          : value === expected
      })
    )
    .map(([name, attr]) => ({ name, attr, readOnly: false }))
}
