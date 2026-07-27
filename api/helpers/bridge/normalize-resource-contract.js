'use strict'

module.exports = {
  friendlyName: 'Normalize Bridge resource contract',

  description:
    'Merge Waterline metadata with a target app Bridge resource configuration.',

  inputs: {
    models: {
      type: 'ref',
      required: true
    },
    config: {
      type: 'ref',
      defaultsTo: {}
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ models, config }) {
    return normalizeBridgeResourceContract({ models, config })
  }
}

/**
 * Normalize Waterline metadata and `sails.config.slipway.bridge` into the
 * serializable contract consumed by every Bridge surface.
 */
function normalizeBridgeResourceContract({ models, config = {} }) {
  const SCHEMA_VERSION = 1
  const DEFAULT_RESOURCE_ACTIONS = [
    'viewAny',
    'view',
    'create',
    'update',
    'delete',
    'bulkDelete'
  ]
  const FIELD_VISIBILITY_SURFACES = ['list', 'show', 'create', 'edit', 'filter']
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
    'authorization',
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
    'sensitive',
    'visibility',
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

    const primaryKey = model.primaryKey || 'id'
    const associations = normalizeAssociations(
      identity,
      model.associations || []
    )
    const attributes = normalizeAttributes(
      identity,
      primaryKey,
      model.attributes || {},
      associations,
      raw
    )
    const fieldNames = Object.keys(attributes)
    const readableFields = fieldNames.filter(
      (name) => !attributes[name].encrypt && !attributes[name].protect
    )
    const allowedListFields = readableFields.filter(
      (name) =>
        name === primaryKey || isAllowedOnSurface(attributes[name], 'list')
    )
    const allowedShowFields = readableFields.filter(
      (name) =>
        name === primaryKey || isAllowedOnSurface(attributes[name], 'show')
    )
    const allowedFilterFields = readableFields.filter((name) =>
      isAllowedOnSurface(attributes[name], 'filter')
    )
    const defaultListFields = allowedListFields.filter(
      (name) =>
        name === primaryKey || isVisibleByDefault(attributes[name], 'list')
    )
    const defaultShowFields = allowedShowFields.filter(
      (name) =>
        name === primaryKey || isVisibleByDefault(attributes[name], 'show')
    )
    const requiresPrimaryKeyInput = needsPrimaryKeyInput(attributes[primaryKey])
    const writableCreateFields = fieldNames.filter((name) => {
      const attribute = attributes[name]
      return (
        !attribute.protect &&
        !attribute.autoCreatedAt &&
        !attribute.autoUpdatedAt &&
        attribute.field?.readOnly !== true &&
        isAllowedOnSurface(attribute, 'create') &&
        (name !== primaryKey || requiresPrimaryKeyInput)
      )
    })
    const writableEditFields = fieldNames.filter((name) => {
      const attribute = attributes[name]
      return (
        name !== primaryKey &&
        !attribute.protect &&
        !attribute.autoCreatedAt &&
        !attribute.autoUpdatedAt &&
        attribute.field?.readOnly !== true &&
        isAllowedOnSurface(attribute, 'edit')
      )
    })
    const defaultCreateFields = writableCreateFields.filter((name) =>
      isVisibleByDefault(attributes[name], 'create')
    )
    const defaultEditFields = writableEditFields.filter((name) =>
      isVisibleByDefault(attributes[name], 'edit')
    )
    const explicitlyListedFields = allowedListFields.filter(
      (name) => attributes[name].field?.visibility?.list === true
    )
    const defaultList = Array.from(
      new Set([
        ...inferListFields(primaryKey, defaultListFields, attributes),
        ...explicitlyListedFields
      ])
    )
    const defaultTitle = inferTitleField(primaryKey, defaultShowFields)
    const defaultSearch = defaultListFields.filter(
      (name) => attributes[name].type === 'string' && !attributes[name].encrypt
    )
    const defaultFilters = allowedFilterFields.filter(
      (name) => attributes[name].field?.visibility?.filter === true
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
        allowedShowFields
      ),
      search: normalizeFieldList(
        identity,
        'search',
        raw.search ?? defaultSearch,
        allowedListFields
      ),
      list: normalizeFieldList(
        identity,
        'list',
        raw.list ?? defaultList,
        allowedListFields
      ),
      show: normalizeFieldList(
        identity,
        'show',
        raw.show ?? defaultShowFields,
        allowedShowFields
      ),
      create: normalizeFieldList(
        identity,
        'create',
        raw.create ?? defaultCreateFields,
        writableCreateFields
      ),
      edit: normalizeFieldList(
        identity,
        'edit',
        raw.edit ?? defaultEditFields,
        writableEditFields
      ),
      filters: normalizeFieldList(
        identity,
        'filters',
        raw.filters ?? defaultFilters,
        allowedFilterFields
      ),
      sort: normalizeSort(
        identity,
        raw.sort,
        defaultSortField,
        allowedListFields
      ),
      hidden: raw.hidden === true,
      configured,
      actions: normalizeActions(identity, raw.actions),
      authorization: normalizeAuthorization(identity, raw.authorization),
      attributes,
      associations
    }

    if (!resource.list.includes(primaryKey)) {
      resource.list.unshift(primaryKey)
    }
    if (!resource.show.includes(primaryKey)) {
      resource.show.unshift(primaryKey)
    }
    if (
      requiresPrimaryKeyInput &&
      writableCreateFields.includes(primaryKey) &&
      !resource.hidden &&
      resource.actions.create &&
      !resource.create.includes(primaryKey)
    ) {
      resource.create.unshift(primaryKey)
    }

    return resource
  }

  function normalizeAttributes(
    identity,
    primaryKey,
    rawAttributes,
    associations,
    rawResource
  ) {
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
      assertOptionalBoolean(
        fieldOptions[name].sensitive,
        `Bridge field "${identity}.${name}".sensitive`
      )
      validateFieldVisibility(identity, name, fieldOptions[name].visibility)
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
      validateGeneratedDefault(
        identity,
        name,
        primaryKey,
        fieldOptions[name].default
      )
    }

    const attributes = {}
    for (const [name, attribute] of Object.entries(rawAttributes)) {
      const rawField = fieldOptions[name] || {}
      const safeField = {}
      const association = associations.find(
        (candidate) => candidate.type === 'model' && candidate.alias === name
      )

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
        ...(association?.primaryKeyType
          ? { type: association.primaryKeyType }
          : {}),
        label: readString(rawField.label) || humanize(name),
        sensitive:
          attribute.protect === true ||
          attribute.encrypt === true ||
          rawField.sensitive === true ||
          (rawField.sensitive !== false && hasSensitiveName(name)),
        field: safeField
      }
    }
    return attributes
  }

  function normalizeAssociations(identity, rawAssociations) {
    if (!Array.isArray(rawAssociations)) {
      throw new Error(
        `Waterline metadata for "${identity}" has invalid associations.`
      )
    }

    return rawAssociations.map((association) => {
      const normalized = { ...association }
      if (association.type !== 'model') return normalized

      const relatedModel = models[association.model]
      const primaryKey =
        association.primaryKey || relatedModel?.primaryKey || 'id'
      const primaryKeyAttribute = relatedModel?.attributes?.[primaryKey]
      const primaryKeyType =
        association.primaryKeyType || primaryKeyAttribute?.type

      return {
        ...normalized,
        primaryKey,
        ...(primaryKeyType ? { primaryKeyType } : {})
      }
    })
  }

  function hasGeneratedPrimaryKey(attribute) {
    return (
      attribute.autoIncrement === true ||
      attribute.defaultsTo !== undefined ||
      isHelperDefault(attribute.field?.default)
    )
  }

  function needsPrimaryKeyInput(attribute) {
    return attribute?.required === true && !hasGeneratedPrimaryKey(attribute)
  }

  function validateGeneratedDefault(identity, name, primaryKey, defaultValue) {
    if (!isHelperDefault(defaultValue)) return
    if (name !== primaryKey) {
      throw new Error(
        `Bridge helper defaults are currently supported only for the primary key "${identity}.${primaryKey}".`
      )
    }

    rejectUnknownKeys(
      defaultValue,
      ['helper'],
      `Bridge field "${identity}.${name}".default`
    )
    if (
      typeof defaultValue.helper !== 'string' ||
      !/^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*$/.test(
        defaultValue.helper
      ) ||
      defaultValue.helper
        .split('.')
        .some((part) =>
          ['__proto__', 'constructor', 'prototype'].includes(part)
        )
    ) {
      throw new Error(
        `Bridge field "${identity}.${name}".default.helper must be a safe Sails helper identity.`
      )
    }
  }

  function isHelperDefault(value) {
    return (
      isPlainObject(value) &&
      Object.prototype.hasOwnProperty.call(value, 'helper')
    )
  }

  function normalizeActions(identity, rawActions) {
    if (rawActions !== undefined && !isPlainObject(rawActions)) {
      throw new Error(
        `Bridge resource "${identity}".actions must be an object.`
      )
    }

    for (const action of Object.keys(rawActions || {})) {
      if (!isSafeIdentifier(action)) {
        throw new Error(
          `Bridge action "${identity}.${action}" must use a safe action name.`
        )
      }
    }

    const actions = {}
    for (const action of Array.from(
      new Set([...DEFAULT_RESOURCE_ACTIONS, ...Object.keys(rawActions || {})])
    )) {
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

  function normalizeAuthorization(identity, rawAuthorization) {
    if (rawAuthorization === undefined) return null

    const authorization =
      typeof rawAuthorization === 'string'
        ? { helper: rawAuthorization }
        : rawAuthorization
    if (!isPlainObject(authorization)) {
      throw new Error(
        `Bridge resource "${identity}".authorization must be a helper identity or an object.`
      )
    }
    rejectUnknownKeys(
      authorization,
      ['helper'],
      `Bridge resource "${identity}".authorization`
    )
    if (!isSafeHelperIdentity(authorization.helper)) {
      throw new Error(
        `Bridge resource "${identity}".authorization.helper must be a safe Sails helper identity.`
      )
    }
    return { helper: authorization.helper }
  }

  function validateFieldVisibility(identity, name, visibility) {
    if (visibility === undefined) return
    if (!isPlainObject(visibility)) {
      throw new Error(
        `Bridge field "${identity}.${name}".visibility must be an object.`
      )
    }
    rejectUnknownKeys(
      visibility,
      FIELD_VISIBILITY_SURFACES,
      `Bridge field "${identity}.${name}".visibility`
    )
    for (const surface of FIELD_VISIBILITY_SURFACES) {
      assertOptionalBoolean(
        visibility[surface],
        `Bridge field "${identity}.${name}".visibility.${surface}`
      )
    }
  }

  function isAllowedOnSurface(attribute, surface) {
    return attribute.field?.visibility?.[surface] !== false
  }

  function isVisibleByDefault(attribute, surface) {
    const configuredVisibility = attribute.field?.visibility?.[surface]
    if (configuredVisibility !== undefined) return configuredVisibility
    return attribute.sensitive !== true
  }

  function hasSensitiveName(name) {
    const normalized = String(name)
      .replace(/[^A-Za-z0-9]/g, '')
      .toLowerCase()
    if (
      ['emailchangecandidate', 'plancode', 'subscriptioncode'].includes(
        normalized
      )
    ) {
      return true
    }
    return /(password|passwd|passphrase|secret|token|apikey|privatekey|signingkey|credential|totp|otp|recoverycode|backupcode|verificationcode|authcode)/.test(
      normalized
    )
  }

  function isSafeIdentifier(value) {
    return (
      typeof value === 'string' &&
      /^[A-Za-z][A-Za-z0-9]*$/.test(value) &&
      !['__proto__', 'constructor', 'prototype'].includes(value)
    )
  }

  function isSafeHelperIdentity(value) {
    return (
      typeof value === 'string' &&
      value.split('.').every((part) => isSafeIdentifier(part))
    )
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
