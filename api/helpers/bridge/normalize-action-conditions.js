module.exports = {
  friendlyName: 'Normalize action conditions',
  description:
    'Normalize bounded scalar record and sibling-form visibility conditions.',
  sync: true,
  inputs: {
    condition: { type: 'ref' },
    path: { type: 'ref' }
  },
  exits: { success: { outputType: 'ref' } },
  fn: function ({ condition, path }) {
    if (condition === undefined) return undefined
    if (
      !condition ||
      typeof condition !== 'object' ||
      Array.isArray(condition) ||
      !Object.keys(condition).length ||
      Object.keys(condition).length > 20
    )
      throw new Error(
        `${path}.visibleWhen must be a non-empty condition object.`
      )
    const result = {}
    for (const [key, value] of Object.entries(condition)) {
      if (
        !/^(record|form)\.[A-Za-z][A-Za-z0-9]*$/.test(key) ||
        ['constructor', 'prototype'].includes(key.split('.')[1])
      )
        throw new Error(
          `${path}.visibleWhen must reference record.field or form.field.`
        )
      if (scalar(value)) result[key] = value
      else if (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.keys(value).length === 1 &&
        Object.prototype.hasOwnProperty.call(value, 'in') &&
        Array.isArray(value.in) &&
        value.in.length > 0 &&
        value.in.length <= 100 &&
        value.in.every(scalar)
      )
        result[key] = { in: [...value.in] }
      else
        throw new Error(
          `${path}.visibleWhen supports scalar equality or a non-empty in array only.`
        )
    }
    return result
  }
}

function scalar(value) {
  return (
    value === null ||
    ['string', 'boolean'].includes(typeof value) ||
    (typeof value === 'number' && Number.isFinite(value))
  )
}
