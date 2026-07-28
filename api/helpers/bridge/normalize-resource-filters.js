module.exports = {
  friendlyName: 'Normalize Bridge resource filters',

  description:
    'Build a type-aware filter contract and safe Waterline where criteria for a Bridge resource.',

  inputs: {
    resource: {
      type: 'ref',
      required: true
    },
    filters: {
      type: 'ref',
      defaultsTo: {}
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ resource, filters }) {
    const definitions = buildDefinitions(resource)
    const values = parseFilters(filters)
    const normalized = {}
    const clauses = []

    if (Object.keys(values).length > 12) {
      throw filterError('Bridge accepts no more than 12 active filters.')
    }

    for (const [field, rawValue] of Object.entries(values)) {
      const definition = definitions[field]
      if (!definition) {
        throw filterError(`Bridge filter "${field}" is unavailable.`)
      }
      const result = normalizeFilterValue(definition, rawValue)
      if (!result) continue
      normalized[field] = result.value
      clauses.push(result.where)
    }

    return {
      definitions,
      filters: normalized,
      where: combineClauses(clauses)
    }
  }
}

const TEXT_FIELD_TYPES = new Set([
  'text',
  'textarea',
  'richtext',
  'email',
  'url'
])
const DATE_FIELD_TYPES = new Set(['date', 'datetime', 'timestamp'])
const SUPPORTED_FIELD_TYPES = new Set([
  ...TEXT_FIELD_TYPES,
  ...DATE_FIELD_TYPES,
  'number',
  'currency',
  'boolean',
  'select',
  'belongsTo'
])
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function buildDefinitions(resource) {
  const definitions = {}

  for (const field of resource.filters || []) {
    if (!isSafeIdentifier(field)) {
      throw filterError(`Bridge filter "${field}" is invalid.`)
    }
    const attribute = resource.attributes?.[field]
    if (
      !attribute ||
      attribute.encrypt ||
      attribute.protect ||
      attribute.field?.visibility?.filter === false
    ) {
      throw filterError(`Bridge filter "${field}" is unavailable.`)
    }

    const type = attribute.field?.type || attribute.type || 'text'
    if (!SUPPORTED_FIELD_TYPES.has(type)) {
      throw filterError(
        `Bridge filter "${field}" uses unsupported field type "${type}".`
      )
    }

    const relationship = resource.relationships?.[field]
    if (
      type === 'belongsTo' &&
      (!relationship || relationship.type !== 'model')
    ) {
      throw filterError(
        `Bridge filter "${field}" does not reference an available belongs-to relationship.`
      )
    }

    const nullable = attribute.allowNull === true || attribute.required !== true
    definitions[field] = {
      field,
      label: attribute.label || humanize(field),
      type,
      valueType: attribute.type,
      defaultOperator: defaultOperator(type),
      operators: operatorsFor(type, nullable),
      nullable,
      ...(Array.isArray(attribute.field?.options)
        ? { options: attribute.field.options }
        : {}),
      ...(relationship
        ? {
            relationship: {
              resource: relationship.resource,
              primaryKey: relationship.primaryKey,
              title: relationship.title,
              searchable: relationship.searchable === true
            }
          }
        : {})
    }
  }

  return definitions
}

function parseFilters(filters) {
  let value = filters
  if (typeof value === 'string') {
    if (value.length > 12_000) {
      throw filterError('Bridge filters are too large.')
    }
    if (!value.trim()) return {}
    try {
      value = JSON.parse(value)
    } catch {
      throw filterError('Bridge filters must contain valid JSON.')
    }
  }

  if (value === undefined || value === null || value === '') return {}
  if (!isPlainObject(value)) {
    throw filterError('Bridge filters must be an object.')
  }

  for (const key of Object.keys(value)) {
    if (!isSafeIdentifier(key)) {
      throw filterError(`Bridge filter "${key}" is invalid.`)
    }
  }
  return value
}

function normalizeFilterValue(definition, rawValue) {
  if (
    rawValue === undefined ||
    rawValue === '' ||
    (rawValue === null && definition.nullable !== true)
  ) {
    return null
  }

  const input = isPlainObject(rawValue)
    ? rawValue
    : { operator: definition.defaultOperator, value: rawValue }
  const operator = String(
    input.operator || inferOperator(definition.type, input)
  )
  if (!definition.operators.includes(operator)) {
    throw filterError(
      `Bridge filter "${definition.field}" does not support "${operator}".`
    )
  }

  if (operator === 'isNull') {
    return {
      value: { operator },
      where: { [definition.field]: null }
    }
  }
  if (operator === 'isNotNull') {
    return {
      value: { operator },
      where: { [definition.field]: { '!=': null } }
    }
  }

  if (operator === 'between') {
    const fromValue = input.from ?? input.min
    const toValue = input.to ?? input.max
    const from = normalizeBound(definition, fromValue)
    const to = normalizeBound(definition, toValue, { upper: true })
    if (from === undefined && to === undefined) return null
    if (from !== undefined && to !== undefined && from > to) {
      throw filterError(
        `Bridge filter "${definition.field}" starts after it ends.`
      )
    }

    const range = {}
    if (from !== undefined) range['>='] = from
    if (to !== undefined) range['<='] = to
    return {
      value: {
        operator,
        ...(from !== undefined
          ? { from: serializeBound(definition, from) }
          : {}),
        ...(to !== undefined ? { to: serializeBound(definition, to) } : {})
      },
      where: { [definition.field]: range }
    }
  }

  const value = normalizeScalar(definition, input.value)
  if (value === undefined) return null
  if (operator === 'contains') {
    return {
      value: { operator, value },
      where: { [definition.field]: { contains: value } }
    }
  }
  return {
    value: { operator, value },
    where: { [definition.field]: value }
  }
}

function normalizeScalar(definition, rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return undefined
  }

  if (TEXT_FIELD_TYPES.has(definition.type)) {
    return boundedString(definition.field, rawValue)
  }
  if (definition.type === 'boolean') {
    if (rawValue === true || rawValue === 'true' || rawValue === 1) return true
    if (rawValue === false || rawValue === 'false' || rawValue === 0) {
      return false
    }
    throw filterError(
      `Bridge filter "${definition.field}" must be true or false.`
    )
  }
  if (definition.type === 'number' || definition.type === 'currency') {
    const value = Number(rawValue)
    if (!Number.isFinite(value)) {
      throw filterError(`Bridge filter "${definition.field}" must be a number.`)
    }
    return value
  }
  if (DATE_FIELD_TYPES.has(definition.type)) {
    return normalizeDate(definition, rawValue)
  }
  if (definition.type === 'select') {
    const option = (definition.options || []).find((candidate) =>
      Object.is(candidate.value, coerceOptionValue(rawValue, candidate.value))
    )
    if (!option || option.disabled === true) {
      throw filterError(
        `Bridge filter "${definition.field}" must use an available option.`
      )
    }
    return option.value
  }
  if (definition.type === 'belongsTo') {
    if (definition.valueType === 'number') {
      const number = Number(rawValue)
      if (!Number.isFinite(number)) {
        throw filterError(
          `Bridge filter "${definition.field}" has an invalid identifier.`
        )
      }
      return number
    }
    return boundedString(definition.field, rawValue)
  }

  throw filterError(`Bridge filter "${definition.field}" is unsupported.`)
}

function normalizeBound(definition, rawValue, { upper = false } = {}) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return undefined
  }
  const value = normalizeScalar(definition, rawValue)
  if (
    upper &&
    ['datetime', 'timestamp'].includes(definition.type) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(rawValue).trim())
  ) {
    return definition.valueType === 'number'
      ? value + 59_999
      : new Date(new Date(value).getTime() + 59_999).toISOString()
  }
  return value
}

function normalizeDate(definition, rawValue) {
  const value = String(rawValue).trim()
  if (definition.type === 'date' && !isValidDateOnly(value)) {
    throw filterError(
      `Bridge filter "${definition.field}" must be a valid date.`
    )
  }
  const date = new Date(
    definition.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? `${value}T00:00:00.000Z`
      : value
  )
  if (Number.isNaN(date.getTime())) {
    throw filterError(
      `Bridge filter "${definition.field}" must be a valid date.`
    )
  }
  if (definition.type === 'date') return value.slice(0, 10)
  return definition.valueType === 'number' ? date.getTime() : date.toISOString()
}

function isValidDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

function serializeBound(definition, value) {
  if (!DATE_FIELD_TYPES.has(definition.type)) return value
  if (definition.type === 'date') return String(value)
  return new Date(value).toISOString()
}

function coerceOptionValue(rawValue, optionValue) {
  if (typeof optionValue === 'boolean') {
    if (rawValue === 'true') return true
    if (rawValue === 'false') return false
  }
  if (typeof optionValue === 'number' && rawValue !== '') {
    const number = Number(rawValue)
    if (Number.isFinite(number)) return number
  }
  if (optionValue === null && rawValue === null) return null
  return rawValue
}

function boundedString(field, value) {
  const string = String(value).trim()
  if (!string) return undefined
  if (string.length > 200) {
    throw filterError(
      `Bridge filter "${field}" must be no longer than 200 characters.`
    )
  }
  return string
}

function defaultOperator(type) {
  if (TEXT_FIELD_TYPES.has(type)) return 'contains'
  if (type === 'number' || type === 'currency' || DATE_FIELD_TYPES.has(type)) {
    return 'between'
  }
  return 'equals'
}

function operatorsFor(type, nullable) {
  const operators = TEXT_FIELD_TYPES.has(type)
    ? ['contains', 'equals']
    : type === 'number' || type === 'currency' || DATE_FIELD_TYPES.has(type)
    ? ['between', 'equals']
    : ['equals']
  if (nullable) operators.push('isNull', 'isNotNull')
  return operators
}

function inferOperator(type, input) {
  if (type === 'number' || type === 'currency' || DATE_FIELD_TYPES.has(type)) {
    if (
      input.from !== undefined ||
      input.to !== undefined ||
      input.min !== undefined ||
      input.max !== undefined
    ) {
      return 'between'
    }
  }
  return defaultOperator(type)
}

function combineClauses(clauses) {
  if (clauses.length === 0) return {}
  if (clauses.length === 1) return clauses[0]
  return { and: clauses }
}

function humanize(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isSafeIdentifier(value) {
  return (
    typeof value === 'string' &&
    /^[A-Za-z][A-Za-z0-9_]*$/.test(value) &&
    !UNSAFE_KEYS.has(value)
  )
}

function filterError(message) {
  const error = new Error(message)
  error.code = 'BRIDGE_FILTER_INVALID'
  return error
}
