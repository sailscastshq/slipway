'use strict'

const DASHBOARD_SCOPES = ['global', 'project', 'environment', 'resource']
const CARD_TYPES = [
  'metric',
  'recent',
  'action',
  'trend',
  'partition',
  'custom'
]
const AGGREGATES = ['count', 'sum', 'average', 'min', 'max']
const VALUE_FORMATS = ['number', 'compact', 'currency', 'percent']
const DASHBOARD_KEYS = [
  'label',
  'description',
  'default',
  'scope',
  'resource',
  'cards'
]
const COMMON_CARD_KEYS = ['type', 'label', 'description', 'resource']
const CARD_KEYS = {
  metric: [
    ...COMMON_CARD_KEYS,
    'aggregate',
    'field',
    'where',
    'format',
    'currency',
    'prefix',
    'suffix'
  ],
  recent: [...COMMON_CARD_KEYS, 'fields', 'limit', 'sort'],
  action: [...COMMON_CARD_KEYS, 'action'],
  trend: [...COMMON_CARD_KEYS, 'helper'],
  partition: [...COMMON_CARD_KEYS, 'helper'],
  custom: [...COMMON_CARD_KEYS, 'helper']
}

module.exports = {
  friendlyName: 'Normalize Bridge dashboard contract',

  description:
    'Validate target-app Bridge dashboards against the normalized resource contract.',

  inputs: {
    dashboard: {
      type: 'ref'
    },
    dashboards: {
      type: 'ref'
    },
    resources: {
      type: 'ref',
      required: true
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ dashboard, dashboards, resources }) {
    if (!isPlainObject(resources)) {
      throw new Error('Bridge dashboards require normalized resources.')
    }
    if (dashboard !== undefined && dashboards !== undefined) {
      throw new Error(
        'Configure either sails.config.slipway.bridge.dashboard or dashboards, not both.'
      )
    }

    let definitions = dashboards
    if (dashboard !== undefined) {
      definitions = { overview: dashboard }
    }
    if (definitions === undefined) return {}
    if (!isPlainObject(definitions)) {
      throw new Error(
        'sails.config.slipway.bridge.dashboards must be an object.'
      )
    }
    if (Object.keys(definitions).length > 12) {
      throw new Error('Bridge cannot contain more than 12 dashboards.')
    }

    const normalized = {}
    const defaultByScope = new Map()

    for (const [id, rawDashboard] of Object.entries(definitions)) {
      assertSafeIdentifier(id, `Bridge dashboard "${id}"`)
      if (!isPlainObject(rawDashboard)) {
        throw new Error(`Bridge dashboard "${id}" must be an object.`)
      }
      rejectUnknownKeys(
        rawDashboard,
        DASHBOARD_KEYS,
        `Bridge dashboard "${id}"`
      )
      assertOptionalString(
        rawDashboard.label,
        `Bridge dashboard "${id}".label`,
        80
      )
      assertOptionalString(
        rawDashboard.description,
        `Bridge dashboard "${id}".description`,
        240
      )
      assertOptionalBoolean(
        rawDashboard.default,
        `Bridge dashboard "${id}".default`
      )

      const scope = rawDashboard.scope || 'environment'
      if (!DASHBOARD_SCOPES.includes(scope)) {
        throw new Error(
          `Bridge dashboard "${id}".scope must be one of: ${DASHBOARD_SCOPES.join(
            ', '
          )}.`
        )
      }

      let resource = rawDashboard.resource
      if (scope === 'resource' && !resource) {
        throw new Error(
          `Bridge dashboard "${id}".resource is required for resource-scoped dashboards.`
        )
      }
      if (resource !== undefined) {
        resource = normalizeResourceReference(
          resource,
          resources,
          `Bridge dashboard "${id}".resource`
        )
      }
      if (scope !== 'resource' && resource !== undefined) {
        throw new Error(
          `Bridge dashboard "${id}".resource is supported only when scope is "resource".`
        )
      }

      if (!isPlainObject(rawDashboard.cards)) {
        throw new Error(`Bridge dashboard "${id}".cards must be an object.`)
      }

      const cards = []
      for (const [cardId, rawCard] of Object.entries(rawDashboard.cards)) {
        cards.push(
          normalizeCard({
            dashboardId: id,
            cardId,
            rawCard,
            dashboardResource: resource,
            resources
          })
        )
      }
      if (cards.length === 0) {
        throw new Error(`Bridge dashboard "${id}".cards cannot be empty.`)
      }
      if (cards.length > 24) {
        throw new Error(
          `Bridge dashboard "${id}" cannot contain more than 24 cards.`
        )
      }

      const defaultKey = `${scope}:${resource || ''}`
      if (rawDashboard.default === true) {
        if (defaultByScope.has(defaultKey)) {
          throw new Error(
            `Bridge dashboards "${defaultByScope.get(
              defaultKey
            )}" and "${id}" cannot both be default for the same scope.`
          )
        }
        defaultByScope.set(defaultKey, id)
      }

      normalized[id] = {
        id,
        label: readString(rawDashboard.label) || humanize(id),
        description: readString(rawDashboard.description),
        default: rawDashboard.default === true,
        scope,
        resource: resource || null,
        cards
      }
    }

    for (const dashboard of Object.values(normalized)) {
      const defaultKey = `${dashboard.scope}:${dashboard.resource || ''}`
      if (!defaultByScope.has(defaultKey)) {
        dashboard.default = true
        defaultByScope.set(defaultKey, dashboard.id)
      }
    }

    return normalized
  }
}

function normalizeCard({
  dashboardId,
  cardId,
  rawCard,
  dashboardResource,
  resources
}) {
  const path = `Bridge dashboard card "${dashboardId}.${cardId}"`
  assertSafeIdentifier(cardId, path)
  if (!isPlainObject(rawCard)) {
    throw new Error(`${path} must be an object.`)
  }

  const type = rawCard.type
  if (!CARD_TYPES.includes(type)) {
    throw new Error(`${path}.type must be one of: ${CARD_TYPES.join(', ')}.`)
  }
  rejectUnknownKeys(rawCard, CARD_KEYS[type], path)
  assertOptionalString(rawCard.label, `${path}.label`, 80)
  assertOptionalString(rawCard.description, `${path}.description`, 240)

  let resourceReference = rawCard.resource ?? dashboardResource
  if (['metric', 'recent', 'action'].includes(type) && !resourceReference) {
    throw new Error(`${path}.resource is required for ${type} cards.`)
  }
  const resource = resourceReference
    ? normalizeResourceReference(
        resourceReference,
        resources,
        `${path}.resource`
      )
    : null
  const resourceContract = resource ? resources[resource] : null
  const common = {
    id: cardId,
    type,
    label:
      readString(rawCard.label) ||
      defaultCardLabel({ cardId, type, resource: resourceContract }),
    description: readString(rawCard.description),
    resource
  }

  if (type === 'metric') {
    return normalizeMetricCard(path, rawCard, resourceContract, common)
  }
  if (type === 'recent') {
    return normalizeRecentCard(path, rawCard, resourceContract, common)
  }
  if (type === 'action') {
    return normalizeActionCard(path, rawCard, resourceContract, common)
  }

  if (!isSafeHelperIdentity(rawCard.helper)) {
    throw new Error(`${path}.helper must be a safe Sails helper identity.`)
  }
  return {
    ...common,
    helper: rawCard.helper
  }
}

function normalizeMetricCard(path, raw, resource, common) {
  const aggregate = raw.aggregate || 'count'
  if (!AGGREGATES.includes(aggregate)) {
    throw new Error(
      `${path}.aggregate must be one of: ${AGGREGATES.join(', ')}.`
    )
  }

  let field = null
  if (aggregate !== 'count') {
    if (typeof raw.field !== 'string' || !raw.field.trim()) {
      throw new Error(`${path}.field is required for ${aggregate} metrics.`)
    }
    field = normalizeReadableField(raw.field, resource, `${path}.field`)
    if (resource.attributes[field]?.type !== 'number') {
      throw new Error(`${path}.field must reference a numeric field.`)
    }
  } else if (raw.field !== undefined) {
    throw new Error(`${path}.field is not used by count metrics.`)
  }

  if (raw.where !== undefined) {
    assertSafeSerializableObject(raw.where, `${path}.where`)
    validateWhereFields(raw.where, resource, `${path}.where`)
  }
  const format = raw.format || 'number'
  if (!VALUE_FORMATS.includes(format)) {
    throw new Error(
      `${path}.format must be one of: ${VALUE_FORMATS.join(', ')}.`
    )
  }
  if (format === 'currency') {
    if (
      typeof raw.currency !== 'string' ||
      !/^[A-Za-z]{3}$/.test(raw.currency)
    ) {
      throw new Error(
        `${path}.currency must be a three-letter currency code when format is "currency".`
      )
    }
  } else if (raw.currency !== undefined) {
    throw new Error(`${path}.currency requires format "currency".`)
  }
  for (const option of ['prefix', 'suffix']) {
    assertOptionalString(raw[option], `${path}.${option}`, 20)
  }

  return {
    ...common,
    aggregate,
    field,
    where: raw.where ? cloneSerializable(raw.where) : {},
    format,
    currency: raw.currency ? raw.currency.toUpperCase() : null,
    prefix: readString(raw.prefix),
    suffix: readString(raw.suffix)
  }
}

function normalizeRecentCard(path, raw, resource, common) {
  if (
    raw.fields !== undefined &&
    (!Array.isArray(raw.fields) ||
      raw.fields.some((field) => typeof field !== 'string'))
  ) {
    throw new Error(`${path}.fields must be an array of field names.`)
  }

  const requestedFields =
    raw.fields ||
    Array.from(
      new Set([resource.primaryKey, resource.title, ...resource.list])
    ).slice(0, 4)
  const fields = Array.from(
    new Set([
      resource.primaryKey,
      ...requestedFields.map((field) =>
        normalizeReadableField(field, resource, `${path}.fields`)
      )
    ])
  )
  const limit = raw.limit ?? 5
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
    throw new Error(`${path}.limit must be an integer from 1 to 10.`)
  }

  const sort = normalizeCardSort(path, raw.sort, resource)
  return {
    ...common,
    fields,
    limit,
    sort
  }
}

function normalizeActionCard(path, raw, resource, common) {
  const action = raw.action || 'create'
  if (action !== 'create') {
    throw new Error(`${path}.action currently supports only "create".`)
  }
  return {
    ...common,
    action
  }
}

function normalizeCardSort(path, rawSort, resource) {
  if (rawSort === undefined) return resource.sort
  if (!isPlainObject(rawSort)) {
    throw new Error(`${path}.sort must be an object.`)
  }
  rejectUnknownKeys(rawSort, ['field', 'direction'], `${path}.sort`)
  const field = normalizeReadableField(
    rawSort.field,
    resource,
    `${path}.sort.field`
  )
  const direction = String(rawSort.direction || 'DESC').toUpperCase()
  if (!['ASC', 'DESC'].includes(direction)) {
    throw new Error(`${path}.sort.direction must be "ASC" or "DESC".`)
  }
  return { field, direction }
}

function normalizeResourceReference(value, resources, path) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${path} must be a resource identity.`)
  }
  const identity = value.trim()
  const resource = resources[identity]
  if (!resource) {
    throw new Error(`${path} references unknown resource "${identity}".`)
  }
  if (resource.hidden === true) {
    throw new Error(`${path} cannot reference hidden resource "${identity}".`)
  }
  return identity
}

function normalizeReadableField(value, resource, path) {
  if (
    typeof value !== 'string' ||
    !Array.from(new Set([...resource.list, ...resource.show])).includes(value)
  ) {
    throw new Error(`${path} references unavailable field "${value}".`)
  }
  return value
}

function defaultCardLabel({ cardId, type, resource }) {
  if (type === 'metric') return humanize(cardId)
  if (type === 'recent') return `Recent ${resource?.label || humanize(cardId)}`
  if (type === 'action')
    return `New ${resource?.singularLabel || humanize(cardId)}`
  return humanize(cardId)
}

function validateWhereFields(where, resource, path) {
  const allowedFields = new Set([
    ...(resource.list || []),
    ...(resource.filters || [])
  ])

  visit(where)

  function visit(node) {
    if (!isPlainObject(node)) return
    for (const [key, value] of Object.entries(node)) {
      if (['and', 'or'].includes(key)) {
        const branches = Array.isArray(value) ? value : [value]
        for (const branch of branches) visit(branch)
        continue
      }
      if (!allowedFields.has(key)) {
        throw new Error(`${path} references unavailable field "${key}".`)
      }
    }
  }
}

function assertSafeSerializableObject(value, path) {
  if (!isPlainObject(value)) {
    throw new Error(`${path} must be an object.`)
  }
  walkSerializable(value, path, 0)
}

function walkSerializable(value, path, depth) {
  if (depth > 8) {
    throw new Error(`${path} cannot be nested more than 8 levels.`)
  }
  if (value === null) return
  if (Array.isArray(value)) {
    if (value.length > 100) {
      throw new Error(`${path} cannot contain arrays longer than 100 items.`)
    }
    for (const item of value) walkSerializable(item, path, depth + 1)
    return
  }
  if (isPlainObject(value)) {
    if (Object.keys(value).length > 50) {
      throw new Error(`${path} cannot contain objects with more than 50 keys.`)
    }
    for (const [key, item] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) {
        throw new Error(`${path} contains an unsafe key.`)
      }
      walkSerializable(item, path, depth + 1)
    }
    return
  }
  if (
    !['string', 'number', 'boolean'].includes(typeof value) ||
    (typeof value === 'number' && !Number.isFinite(value))
  ) {
    throw new Error(`${path} must contain only serializable values.`)
  }
}

function cloneSerializable(value) {
  return JSON.parse(JSON.stringify(value))
}

function rejectUnknownKeys(value, allowed, path) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new Error(`${path} has unsupported option "${key}".`)
    }
  }
}

function assertSafeIdentifier(value, path) {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z][A-Za-z0-9]*$/.test(value) ||
    ['__proto__', 'constructor', 'prototype'].includes(value)
  ) {
    throw new Error(`${path} must use a safe JavaScript-style identifier.`)
  }
}

function isSafeHelperIdentity(value) {
  return (
    typeof value === 'string' &&
    value
      .split('.')
      .every(
        (part) =>
          /^[A-Za-z][A-Za-z0-9]*$/.test(part) &&
          !['__proto__', 'constructor', 'prototype'].includes(part)
      )
  )
}

function assertOptionalString(value, path, maxLength = 240) {
  if (value !== undefined && typeof value !== 'string') {
    throw new Error(`${path} must be a string.`)
  }
  if (typeof value === 'string' && value.trim().length > maxLength) {
    throw new Error(`${path} cannot be longer than ${maxLength} characters.`)
  }
}

function assertOptionalBoolean(value, path) {
  if (value !== undefined && typeof value !== 'boolean') {
    throw new Error(`${path} must be a boolean.`)
  }
}

function readString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function humanize(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (character) => character.toUpperCase())
}

function isPlainObject(value) {
  if (!value || Object.prototype.toString.call(value) !== '[object Object]') {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
