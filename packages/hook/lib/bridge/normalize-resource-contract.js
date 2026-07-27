'use strict'

/**
 * Normalize Waterline metadata and `sails.config.slipway.bridge` into the
 * serializable contract consumed by every Bridge surface.
 *
 * Keep this function dependency-free. Slipway embeds its source in the
 * compatibility introspector while sails-hook-slipway can call it directly.
 */
module.exports = function normalizeBridgeResourceContract({
  models,
  config = {}
}) {
  const SCHEMA_VERSION = 1
  const RESOURCE_ACTIONS = [
    'viewAny',
    'view',
    'create',
    'update',
    'delete',
    'bulkDelete'
  ]
  const RESOURCE_OPTION_KEYS = [
    'label',
    'singularLabel',
    'group',
    'title',
    'search',
    'list',
    'show',
    'create',
    'edit',
    'filters',
    'sort',
    'hidden',
    'actions',
    'fields'
  ]
  const FIELD_OPTION_KEYS = [
    'label',
    'type',
    'format',
    'help',
    'placeholder',
    'readOnly',
    'sortable',
    'options',
    'default',
    'currency',
    'relation',
    'upload'
  ]

  if (!isPlainObject(models)) {
    throw new Error(
      'Bridge requires an object of introspected Waterline models.'
    )
  }
  if (!isPlainObject(config)) {
    throw new Error('sails.config.slipway.bridge must be an object.')
  }

  const requestedVersion = config.schemaVersion ?? SCHEMA_VERSION
  if (requestedVersion !== SCHEMA_VERSION) {
    throw new Error(
      `Unsupported Bridge resource schema version "${requestedVersion}". ` +
        `This Slipway release supports version ${SCHEMA_VERSION}.`
    )
  }

  if (config.resources !== undefined && !isPlainObject(config.resources)) {
    throw new Error('sails.config.slipway.bridge.resources must be an object.')
  }
  if (config.discover !== undefined && typeof config.discover !== 'boolean') {
    throw new Error('sails.config.slipway.bridge.discover must be a boolean.')
  }

  const configuredResources = config.resources || {}
  const discover = config.discover !== false
  const identities = discover
    ? Array.from(
        new Set([...Object.keys(models), ...Object.keys(configuredResources)])
      )
    : Object.keys(configuredResources)
  const resources = {}

  for (const identity of identities) {
    const model = models[identity]
    const rawResource = configuredResources[identity]

    if (!model) {
      throw new Error(
        `Bridge resource "${identity}" does not match a loaded Waterline model.`
      )
    }
    if (
      rawResource !== undefined &&
      rawResource !== false &&
      !isPlainObject(rawResource)
    ) {
      throw new Error(
        `Bridge resource "${identity}" must be an object or false.`
      )
    }

    if (isPlainObject(rawResource)) {
      rejectUnknownKeys(
        rawResource,
        RESOURCE_OPTION_KEYS,
        `Bridge resource "${identity}"`
      )
    }

    resources[identity] = normalizeResource(
      identity,
      model,
      rawResource === false ? { hidden: true } : rawResource || {},
      rawResource !== undefined
    )
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    discover,
    configured: Object.keys(configuredResources).length > 0,
    resources
  }

  function normalizeResource(identity, model, raw, configured) {
    for (const option of ['label', 'singularLabel', 'group']) {
      assertOptionalString(
        raw[option],
        `Bridge resource "${identity}".${option}`
      )
    }
    assertOptionalBoolean(raw.hidden, `Bridge resource "${identity}".hidden`)

    const attributes = normalizeAttributes(
      identity,
      model.attributes || {},
      raw
    )
    const fieldNames = Object.keys(attributes)
    const primaryKey = model.primaryKey || 'id'
    const visibleFields = fieldNames.filter(
      (name) => !attributes[name].encrypt && !attributes[name].protect
    )
    const writableFields = fieldNames.filter((name) => {
      const attribute = attributes[name]
      return (
        name !== primaryKey &&
        !attribute.protect &&
        !attribute.autoCreatedAt &&
        !attribute.autoUpdatedAt &&
        attribute.field?.readOnly !== true
      )
    })
    const defaultList = inferListFields(primaryKey, visibleFields, attributes)
    const defaultTitle = inferTitleField(primaryKey, visibleFields)
    const defaultSearch = visibleFields.filter(
      (name) => attributes[name].type === 'string' && !attributes[name].encrypt
    )
    const defaultSortField = attributes.createdAt ? 'createdAt' : primaryKey
    const label = readString(raw.label) || pluralizeLabel(humanize(identity))
    const singularLabel =
      readString(raw.singularLabel) || singularizeLabel(label)

    const resource = {
      identity: model.identity || identity,
      globalId: model.globalId,
      tableName: model.tableName || identity,
      primaryKey,
      label,
      singularLabel,
      group: readString(raw.group) || 'Resources',
      title: normalizeFieldName(
        identity,
        'title',
        raw.title ?? defaultTitle,
        visibleFields
      ),
      search: normalizeFieldList(
        identity,
        'search',
        raw.search ?? defaultSearch,
        visibleFields
      ),
      list: normalizeFieldList(
        identity,
        'list',
        raw.list ?? defaultList,
        visibleFields
      ),
      show: normalizeFieldList(
        identity,
        'show',
        raw.show ?? visibleFields,
        visibleFields
      ),
      create: normalizeFieldList(
        identity,
        'create',
        raw.create ?? writableFields,
        writableFields
      ),
      edit: normalizeFieldList(
        identity,
        'edit',
        raw.edit ?? writableFields,
        writableFields
      ),
      filters: normalizeFieldList(
        identity,
        'filters',
        raw.filters ?? [],
        visibleFields
      ),
      sort: normalizeSort(identity, raw.sort, defaultSortField, visibleFields),
      hidden: raw.hidden === true,
      configured,
      actions: normalizeActions(identity, raw.actions),
      attributes,
      associations: Array.isArray(model.associations)
        ? model.associations.map((association) => ({ ...association }))
        : []
    }

    if (!resource.list.includes(primaryKey)) {
      resource.list.unshift(primaryKey)
    }
    if (!resource.show.includes(primaryKey)) {
      resource.show.unshift(primaryKey)
    }

    return resource
  }

  function normalizeAttributes(identity, rawAttributes, rawResource) {
    if (!isPlainObject(rawAttributes)) {
      throw new Error(
        `Waterline metadata for "${identity}" has invalid attributes.`
      )
    }
    if (
      rawResource.fields !== undefined &&
      !isPlainObject(rawResource.fields)
    ) {
      throw new Error(`Bridge resource "${identity}".fields must be an object.`)
    }

    const fieldOptions = rawResource.fields || {}
    for (const name of Object.keys(fieldOptions)) {
      if (!Object.prototype.hasOwnProperty.call(rawAttributes, name)) {
        throw new Error(
          `Bridge resource "${identity}".fields references unknown field "${name}".`
        )
      }
      if (!isPlainObject(fieldOptions[name])) {
        throw new Error(`Bridge field "${identity}.${name}" must be an object.`)
      }
      rejectUnknownKeys(
        fieldOptions[name],
        FIELD_OPTION_KEYS,
        `Bridge field "${identity}.${name}"`
      )
      for (const option of ['label', 'type', 'format', 'help', 'placeholder']) {
        assertOptionalString(
          fieldOptions[name][option],
          `Bridge field "${identity}.${name}".${option}`
        )
      }
      for (const option of ['readOnly', 'sortable']) {
        assertOptionalBoolean(
          fieldOptions[name][option],
          `Bridge field "${identity}.${name}".${option}`
        )
      }
      if (
        fieldOptions[name].options !== undefined &&
        !Array.isArray(fieldOptions[name].options)
      ) {
        throw new Error(
          `Bridge field "${identity}.${name}".options must be an array.`
        )
      }
      for (const option of ['relation', 'upload']) {
        if (
          fieldOptions[name][option] !== undefined &&
          !isPlainObject(fieldOptions[name][option])
        ) {
          throw new Error(
            `Bridge field "${identity}.${name}".${option} must be an object.`
          )
        }
      }
    }

    const attributes = {}
    for (const [name, attribute] of Object.entries(rawAttributes)) {
      const rawField = fieldOptions[name] || {}
      const safeField = {}

      for (const key of FIELD_OPTION_KEYS) {
        if (rawField[key] !== undefined) {
          safeField[key] = cloneSerializable(
            rawField[key],
            `${identity}.${name}`
          )
        }
      }

      attributes[name] = {
        ...attribute,
        label: readString(rawField.label) || humanize(name),
        field: safeField
      }
    }
    return attributes
  }

  function normalizeActions(identity, rawActions) {
    if (rawActions !== undefined && !isPlainObject(rawActions)) {
      throw new Error(
        `Bridge resource "${identity}".actions must be an object.`
      )
    }

    rejectUnknownKeys(
      rawActions || {},
      RESOURCE_ACTIONS,
      `Bridge resource "${identity}".actions`
    )

    const actions = {}
    for (const action of RESOURCE_ACTIONS) {
      const value = rawActions?.[action]
      if (value !== undefined && typeof value !== 'boolean') {
        throw new Error(
          `Bridge action "${identity}.${action}" must be a boolean.`
        )
      }
      actions[action] = value !== false
    }
    return actions
  }

  function normalizeSort(identity, rawSort, defaultField, fieldNames) {
    if (rawSort !== undefined && !isPlainObject(rawSort)) {
      throw new Error(`Bridge resource "${identity}".sort must be an object.`)
    }

    const field = normalizeFieldName(
      identity,
      'sort.field',
      rawSort?.field ?? defaultField,
      fieldNames
    )
    const direction = String(rawSort?.direction || 'DESC').toUpperCase()
    if (!['ASC', 'DESC'].includes(direction)) {
      throw new Error(
        `Bridge resource "${identity}".sort.direction must be ASC or DESC.`
      )
    }
    return { field, direction }
  }

  function normalizeFieldList(identity, surface, value, fieldNames) {
    if (!Array.isArray(value)) {
      throw new Error(
        `Bridge resource "${identity}".${surface} must be an array of field names.`
      )
    }

    const unique = []
    for (const entry of value) {
      const field = normalizeFieldName(identity, surface, entry, fieldNames)
      if (!unique.includes(field)) unique.push(field)
    }
    return unique
  }

  function normalizeFieldName(identity, surface, value, fieldNames) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(
        `Bridge resource "${identity}".${surface} must reference a field name.`
      )
    }
    const field = value.trim()
    if (!fieldNames.includes(field)) {
      throw new Error(
        `Bridge resource "${identity}".${surface} references unknown field "${field}".`
      )
    }
    return field
  }

  function inferListFields(primaryKey, visibleFields, attributes) {
    const preferred = [
      'name',
      'title',
      'email',
      'status',
      'slug',
      'type',
      'role',
      'createdAt'
    ]
    const result = []

    if (visibleFields.includes(primaryKey)) result.push(primaryKey)
    for (const name of preferred) {
      if (
        visibleFields.includes(name) &&
        !result.includes(name) &&
        result.length < 6
      ) {
        result.push(name)
      }
    }
    for (const name of visibleFields) {
      const type = attributes[name]?.type
      if (
        !result.includes(name) &&
        !['json', 'ref'].includes(type) &&
        result.length < 6
      ) {
        result.push(name)
      }
    }
    return result
  }

  function inferTitleField(primaryKey, visibleFields) {
    return (
      ['name', 'title', 'email', 'slug'].find((name) =>
        visibleFields.includes(name)
      ) || (visibleFields.includes(primaryKey) ? primaryKey : visibleFields[0])
    )
  }

  function humanize(value) {
    return String(value)
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, (character) => character.toUpperCase())
  }

  function pluralizeLabel(label) {
    if (/(s|x|z|ch|sh)$/i.test(label)) return `${label}es`
    if (/[^aeiou]y$/i.test(label)) return `${label.slice(0, -1)}ies`
    return `${label}s`
  }

  function singularizeLabel(label) {
    if (/ies$/i.test(label)) return `${label.slice(0, -3)}y`
    if (/(ches|shes|xes|zes)$/i.test(label)) return label.slice(0, -2)
    if (/s$/i.test(label) && !/ss$/i.test(label)) return label.slice(0, -1)
    return label
  }

  function cloneSerializable(value, path) {
    assertSerializable(value, path)
    try {
      return JSON.parse(JSON.stringify(value))
    } catch {
      throw new Error(`Bridge field option "${path}" must be serializable.`)
    }
  }

  function assertSerializable(value, path, seen = new Set()) {
    if (
      typeof value === 'function' ||
      typeof value === 'symbol' ||
      typeof value === 'bigint' ||
      value === undefined
    ) {
      throw new Error(`Bridge field option "${path}" must be serializable.`)
    }
    if (!value || typeof value !== 'object') return
    if (seen.has(value)) {
      throw new Error(`Bridge field option "${path}" must be serializable.`)
    }

    seen.add(value)
    for (const [key, nestedValue] of Object.entries(value)) {
      assertSerializable(nestedValue, `${path}.${key}`, seen)
    }
    seen.delete(value)
  }

  function rejectUnknownKeys(value, allowedKeys, path) {
    const unknownKeys = Object.keys(value).filter(
      (key) => !allowedKeys.includes(key)
    )
    if (unknownKeys.length > 0) {
      throw new Error(
        `${path} contains unsupported option "${unknownKeys[0]}".`
      )
    }
  }

  function assertOptionalString(value, path) {
    if (
      value !== undefined &&
      (typeof value !== 'string' || value.trim() === '')
    ) {
      throw new Error(`${path} must be a non-empty string.`)
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

  function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return false
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
  }
}
