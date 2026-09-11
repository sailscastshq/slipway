// Deliberately limited to saved scalar fields: no expressions or nested traversal.
function normalize(condition, path) {
  if (condition === undefined) return undefined
  if (
    !condition ||
    typeof condition !== 'object' ||
    Array.isArray(condition) ||
    !Object.keys(condition).length ||
    Object.keys(condition).length > 20
  )
    throw new Error(`${path}.visibleWhen must be a non-empty condition object.`)
  const result = {}
  for (const [key, value] of Object.entries(condition)) {
    if (
      !/^record\.[A-Za-z][A-Za-z0-9]*$/.test(key) ||
      ['constructor', 'prototype'].includes(key.slice(7))
    )
      throw new Error(`${path}.visibleWhen must reference record.field.`)
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
function scalar(value) {
  return (
    value === null ||
    ['string', 'boolean'].includes(typeof value) ||
    (typeof value === 'number' && Number.isFinite(value))
  )
}
function matches(condition, record) {
  return Object.entries(condition || {}).every(([path, expected]) => {
    const field = path.slice(7)
    if (!record || !Object.prototype.hasOwnProperty.call(record, field))
      return false
    return expected && typeof expected === 'object'
      ? expected.in.includes(record[field])
      : record[field] === expected
  })
}
function fields(action) {
  return [
    ...new Set(
      [
        action.visibleWhen,
        ...Object.values(action.fields || {}).map((field) => field.visibleWhen)
      ].flatMap((condition) =>
        Object.keys(condition || {}).map((path) => path.slice(7))
      )
    )
  ].sort()
}
function validate(action, resource) {
  const references = fields(action)
  if (references.length && action.scope !== 'record')
    throw new Error(
      `Bridge action "${action.name}" visibleWhen requires record scope.`
    )
  for (const name of references) {
    const attr = resource.attributes[name]
    if (
      !attr ||
      !resource.show.includes(name) ||
      attr.sensitive ||
      attr.model ||
      attr.collection ||
      !['string', 'number', 'boolean'].includes(attr.type) ||
      attr.field?.type === 'currency'
    )
      throw new Error(
        `Bridge action "${action.name}" condition field "${name}" must be a visible, non-sensitive scalar record field.`
      )
  }
}
function effective(action, record) {
  return {
    ...action,
    fields: Object.fromEntries(
      Object.entries(action.fields || {}).filter(([, field]) =>
        matches(field.visibleWhen, record)
      )
    )
  }
}
function changedMessage(resource, fields) {
  const subject = String(resource.singularLabel || 'record').toLowerCase()
  return fields.length === 1 && fields[0] === 'status'
    ? `This ${subject}'s status changed. Reopen the action to review it before sending.`
    : `This ${subject}'s action fields changed. Reopen the action to review them before sending.`
}
module.exports = {
  normalize,
  matches,
  fields,
  validate,
  effective,
  changedMessage
}
