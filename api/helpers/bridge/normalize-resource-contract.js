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
  const FIELD_TYPES = [
    'text',
    'textarea',
    'richtext',
    'email',
    'url',
    'number',
    'currency',
    'boolean',
    'select',
    'belongsTo',
    'json',
    'date',
    'datetime',
    'timestamp',
    'password',
    'secret',
    'file',
    'image',
    'upload'
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
    'authorization',
    'fields',
    'relationships'
  ]
  const RELATIONSHIP_OPTION_KEYS = [
    'label',
    'show',
    'searchable',
    'search',
    'fields',
    'limit',
    'attach',
    'detach'
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
    'upload',
    'component'
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

  for (const [identity, resource] of Object.entries(resources)) {
    const rawResource = configuredResources[identity]
    resource.relationships = normalizeRelationships(
      identity,
      resource,
      isPlainObject(rawResource) ? rawResource.relationships : undefined,
      resources
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
      for (const option of [
        'label',
        'type',
        'format',
        'help',
        'placeholder',
        'component'
      ]) {
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
      if (fieldOptions[name].type !== undefined) {
        const normalizedType = normalizeFieldType(fieldOptions[name].type)
        if (!FIELD_TYPES.includes(normalizedType)) {
          throw new Error(
            `Bridge field "${identity}.${name}".type must be one of: ${FIELD_TYPES.join(
              ', '
            )}.`
          )
        }
      }
      validateFieldOptions(identity, name, fieldOptions[name].options)
      validateCurrency(identity, name, fieldOptions[name].currency)
      validateUpload(identity, name, fieldOptions[name].upload)
      validateRelationshipOptions(
        identity,
        name,
        fieldOptions[name].relation,
        associations.find(
          (candidate) => candidate.type === 'model' && candidate.alias === name
        )
      )
      if (
        fieldOptions[name].component !== undefined &&
        !isSafeComponentName(fieldOptions[name].component)
      ) {
        throw new Error(
          `Bridge field "${identity}.${name}".component must be a safe registered component name.`
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

      safeField.type = inferFieldType({
        name,
        attribute,
        association,
        configuredType: rawField.type
      })
      const optionSource =
        rawField.options ?? attribute.isIn ?? attribute.validations?.isIn
      if (optionSource !== undefined) {
        safeField.options = normalizeFieldOptions(optionSource)
      }
      if (safeField.type === 'currency') {
        safeField.currency = normalizeCurrency(rawField.currency)
      }
      if (['file', 'image', 'upload'].includes(safeField.type)) {
        safeField.upload = normalizeUpload(safeField.type, rawField.upload)
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

  function normalizeRelationships(
    identity,
    resource,
    rawRelationships,
    normalizedResources
  ) {
    if (rawRelationships !== undefined && !isPlainObject(rawRelationships)) {
      throw new Error(
        `Bridge resource "${identity}".relationships must be an object.`
      )
    }

    const associationsByAlias = new Map(
      resource.associations.map((association) => [
        association.alias,
        association
      ])
    )
    for (const alias of Object.keys(rawRelationships || {})) {
      if (!associationsByAlias.has(alias)) {
        throw new Error(
          `Bridge resource "${identity}".relationships references unknown association "${alias}".`
        )
      }
    }

    const relationships = {}
    for (const association of resource.associations) {
      const fieldRelation =
        association.type === 'model'
          ? resource.attributes[association.alias]?.field?.relation
          : undefined
      const configuredRelationship = rawRelationships?.[association.alias]
      const raw =
        configuredRelationship === undefined
          ? fieldRelation
          : configuredRelationship

      if (raw !== undefined && raw !== false && !isPlainObject(raw)) {
        throw new Error(
          `Bridge relationship "${identity}.${association.alias}" must be an object or false.`
        )
      }
      if (isPlainObject(raw)) {
        validateRelationshipOptions(
          identity,
          association.alias,
          raw,
          association
        )
      }

      const relatedIdentity =
        association.type === 'model'
          ? association.model
          : association.collection
      const relatedResource = normalizedResources[relatedIdentity]
      const hidden = !relatedResource || relatedResource.hidden === true
      const disabled = raw === false
      const defaultFields = relatedResource
        ? Array.from(
            new Set([relatedResource.primaryKey, relatedResource.title])
          ).filter((field) => relatedResource.show.includes(field))
        : []
      const searchFields = normalizeRelationshipFieldList({
        identity,
        alias: association.alias,
        option: 'search',
        value: raw?.search,
        allowed: relatedResource?.search || []
      })
      const configuredFields = normalizeRelationshipFieldList({
        identity,
        alias: association.alias,
        option: 'fields',
        value: raw?.fields,
        allowed: relatedResource?.show || [],
        defaults: defaultFields
      })
      const fields = relatedResource
        ? Array.from(
            new Set([
              relatedResource.primaryKey,
              relatedResource.title,
              ...configuredFields
            ])
          )
        : configuredFields
      const defaultLimit = association.type === 'model' ? 20 : 5
      const limit = raw?.limit ?? defaultLimit
      const showByDefault =
        association.type === 'collection'
          ? true
          : resource.show.includes(association.alias)
      const relationship = {
        alias: association.alias,
        type: association.type,
        resource: relatedIdentity,
        label:
          readString(raw?.label) ||
          (association.type === 'collection'
            ? relatedResource?.label
            : resource.attributes[association.alias]?.label ||
              relatedResource?.singularLabel) ||
          humanize(association.alias),
        primaryKey:
          relatedResource?.primaryKey || association.primaryKey || 'id',
        title:
          relatedResource?.title ||
          relatedResource?.primaryKey ||
          association.primaryKey ||
          'id',
        show: !hidden && !disabled && (raw?.show ?? showByDefault),
        searchable:
          !hidden && !disabled && (raw?.searchable ?? searchFields.length > 0),
        search: searchFields,
        fields,
        limit,
        attach:
          association.type === 'collection' &&
          !hidden &&
          !disabled &&
          raw?.attach === true,
        detach:
          association.type === 'collection' &&
          !hidden &&
          !disabled &&
          raw?.detach === true,
        ...(association.via ? { via: association.via } : {}),
        ...(association.dominant !== undefined
          ? { dominant: association.dominant === true }
          : {})
      }

      relationships[association.alias] = relationship
      if (
        association.type === 'model' &&
        resource.attributes[association.alias]
      ) {
        resource.attributes[association.alias].field.relation = relationship
      }
    }

    return relationships
  }

  function validateRelationshipOptions(identity, alias, relation, association) {
    if (relation === undefined) return
    if (!association) {
      throw new Error(
        `Bridge field "${identity}.${alias}".relation requires a belongs-to association.`
      )
    }
    if (!isPlainObject(relation)) {
      throw new Error(
        `Bridge relationship "${identity}.${alias}" must be an object.`
      )
    }
    rejectUnknownKeys(
      relation,
      RELATIONSHIP_OPTION_KEYS,
      `Bridge relationship "${identity}.${alias}"`
    )
    assertOptionalString(
      relation.label,
      `Bridge relationship "${identity}.${alias}".label`
    )
    for (const option of ['show', 'searchable', 'attach', 'detach']) {
      assertOptionalBoolean(
        relation[option],
        `Bridge relationship "${identity}.${alias}".${option}`
      )
    }
    for (const option of ['search', 'fields']) {
      if (
        relation[option] !== undefined &&
        (!Array.isArray(relation[option]) ||
          relation[option].some((value) => typeof value !== 'string'))
      ) {
        throw new Error(
          `Bridge relationship "${identity}.${alias}".${option} must be an array of field names.`
        )
      }
    }
    if (
      relation.limit !== undefined &&
      (!Number.isInteger(relation.limit) ||
        relation.limit < 1 ||
        relation.limit > 50)
    ) {
      throw new Error(
        `Bridge relationship "${identity}.${alias}".limit must be an integer from 1 to 50.`
      )
    }
    if (
      association?.type === 'model' &&
      (relation.attach !== undefined || relation.detach !== undefined)
    ) {
      throw new Error(
        `Bridge relationship "${identity}.${alias}" can enable attach or detach only for a collection association.`
      )
    }
  }

  function normalizeRelationshipFieldList({
    identity,
    alias,
    option,
    value,
    allowed,
    defaults = allowed
  }) {
    const selected = value === undefined ? defaults : value
    for (const field of selected) {
      if (!allowed.includes(field)) {
        throw new Error(
          `Bridge relationship "${identity}.${alias}".${option} references unavailable field "${field}".`
        )
      }
    }
    return Array.from(new Set(selected))
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

  function inferFieldType({ name, attribute, association, configuredType }) {
    if (configuredType) return normalizeFieldType(configuredType)
    if (association) return 'belongsTo'
    if (attribute.encrypt || attribute.protect) return 'password'
    if (attribute.isEmail || attribute.validations?.isEmail) return 'email'
    if (attribute.isURL || attribute.validations?.isURL) return 'url'
    if (
      Array.isArray(attribute.isIn) ||
      Array.isArray(attribute.validations?.isIn)
    ) {
      return 'select'
    }
    if (attribute.type === 'boolean') return 'boolean'
    if (attribute.type === 'json' || attribute.type === 'ref') return 'json'
    if (attribute.autoCreatedAt || attribute.autoUpdatedAt) return 'timestamp'
    if (attribute.type === 'number') return 'number'
    const dateFieldType = inferDateFieldType(attribute.columnType)
    if (dateFieldType) return dateFieldType
    if (attribute.type === 'string' && looksLikeLongText(name, attribute)) {
      return 'textarea'
    }
    return 'text'
  }

  function normalizeFieldType(type) {
    const normalized = String(type).trim()
    if (normalized === 'toggle') return 'boolean'
    if (normalized === 'string') return 'text'
    return normalized
  }

  function inferDateFieldType(columnType) {
    if (typeof columnType !== 'string') return null
    if (/^\s*date\s*$/i.test(columnType)) return 'date'
    if (/(date|time|timestamp)/i.test(columnType)) return 'datetime'
    return null
  }

  function looksLikeLongText(name, attribute) {
    if (
      typeof attribute.columnType === 'string' &&
      /(text|clob)/i.test(attribute.columnType)
    ) {
      return true
    }
    return /(content|body|description|bio|about|summary|notes|markdown|html)/i.test(
      name
    )
  }

  function validateFieldOptions(identity, name, options) {
    if (options === undefined) return
    for (const [index, option] of options.entries()) {
      if (
        ['string', 'number', 'boolean'].includes(typeof option) ||
        option === null
      ) {
        continue
      }
      if (!isPlainObject(option)) {
        throw new Error(
          `Bridge field "${identity}.${name}".options[${index}] must be a primitive or an option object.`
        )
      }
      rejectUnknownKeys(
        option,
        ['label', 'value', 'disabled'],
        `Bridge field "${identity}.${name}".options[${index}]`
      )
      if (!Object.prototype.hasOwnProperty.call(option, 'value')) {
        throw new Error(
          `Bridge field "${identity}.${name}".options[${index}].value is required.`
        )
      }
      if (
        !['string', 'number', 'boolean'].includes(typeof option.value) &&
        option.value !== null
      ) {
        throw new Error(
          `Bridge field "${identity}.${name}".options[${index}].value must be a string, number, boolean, or null.`
        )
      }
      assertOptionalString(
        option.label,
        `Bridge field "${identity}.${name}".options[${index}].label`
      )
      assertOptionalBoolean(
        option.disabled,
        `Bridge field "${identity}.${name}".options[${index}].disabled`
      )
    }
  }

  function normalizeFieldOptions(options) {
    return options.map((option) => {
      if (isPlainObject(option)) {
        return {
          label:
            readString(option.label) ||
            (option.value === null ? 'None' : String(option.value)),
          value: option.value,
          disabled: option.disabled === true
        }
      }
      return {
        label: option === null ? 'None' : String(option),
        value: option,
        disabled: false
      }
    })
  }

  function validateCurrency(identity, name, currency) {
    if (currency === undefined) return
    if (!isPlainObject(currency)) {
      throw new Error(
        `Bridge field "${identity}.${name}".currency must be an object.`
      )
    }
    rejectUnknownKeys(
      currency,
      [
        'code',
        'locale',
        'storage',
        'submit',
        'minimumFractionDigits',
        'maximumFractionDigits'
      ],
      `Bridge field "${identity}.${name}".currency`
    )
    assertOptionalString(
      currency.code,
      `Bridge field "${identity}.${name}".currency.code`
    )
    assertOptionalString(
      currency.locale,
      `Bridge field "${identity}.${name}".currency.locale`
    )
    for (const option of ['storage', 'submit']) {
      if (
        currency[option] !== undefined &&
        !['major', 'minor'].includes(currency[option])
      ) {
        throw new Error(
          `Bridge field "${identity}.${name}".currency.${option} must be "major" or "minor".`
        )
      }
    }
    for (const option of ['minimumFractionDigits', 'maximumFractionDigits']) {
      const value = currency[option]
      if (
        value !== undefined &&
        (!Number.isInteger(value) || value < 0 || value > 20)
      ) {
        throw new Error(
          `Bridge field "${identity}.${name}".currency.${option} must be an integer from 0 to 20.`
        )
      }
    }
  }

  function normalizeCurrency(currency = {}) {
    const code = readString(currency.code) || 'USD'
    if (!/^[A-Za-z]{3}$/.test(code)) {
      throw new Error(
        'Bridge currency codes must use a three-letter ISO 4217 code.'
      )
    }
    const minimumFractionDigits = currency.minimumFractionDigits ?? 2
    const maximumFractionDigits =
      currency.maximumFractionDigits ?? minimumFractionDigits
    if (maximumFractionDigits < minimumFractionDigits) {
      throw new Error(
        'Bridge currency maximumFractionDigits cannot be smaller than minimumFractionDigits.'
      )
    }
    return {
      code: code.toUpperCase(),
      locale: readString(currency.locale) || 'en-US',
      storage: currency.storage || 'major',
      submit: currency.submit || 'major',
      minimumFractionDigits,
      maximumFractionDigits
    }
  }

  function validateUpload(identity, name, upload) {
    if (upload === undefined) return
    if (!isPlainObject(upload)) {
      throw new Error(
        `Bridge field "${identity}.${name}".upload must be an object.`
      )
    }
    rejectUnknownKeys(
      upload,
      ['kind', 'storage', 'directory', 'store', 'accept', 'maxBytes'],
      `Bridge field "${identity}.${name}".upload`
    )
    for (const option of ['kind', 'storage', 'directory', 'store']) {
      assertOptionalString(
        upload[option],
        `Bridge field "${identity}.${name}".upload.${option}`
      )
    }
    if (upload.kind !== undefined && !['image', 'file'].includes(upload.kind)) {
      throw new Error(
        `Bridge field "${identity}.${name}".upload.kind must be "image" or "file".`
      )
    }
    if (upload.storage !== undefined && upload.storage !== 'bridge') {
      throw new Error(
        `Bridge field "${identity}.${name}".upload.storage must be "bridge".`
      )
    }
    if (upload.store !== undefined && upload.store !== 'url') {
      throw new Error(
        `Bridge field "${identity}.${name}".upload.store must be "url".`
      )
    }
    if (
      upload.directory !== undefined &&
      !/^[A-Za-z0-9](?:[A-Za-z0-9_-]|\/(?=[A-Za-z0-9]))*$/.test(
        upload.directory
      )
    ) {
      throw new Error(
        `Bridge field "${identity}.${name}".upload.directory must be a safe relative object path.`
      )
    }
    if (
      upload.accept !== undefined &&
      !(
        typeof upload.accept === 'string' ||
        (Array.isArray(upload.accept) &&
          upload.accept.every(
            (value) => typeof value === 'string' && value.trim()
          ))
      )
    ) {
      throw new Error(
        `Bridge field "${identity}.${name}".upload.accept must be a MIME type string or array.`
      )
    }
    if (
      upload.maxBytes !== undefined &&
      (!Number.isSafeInteger(upload.maxBytes) ||
        upload.maxBytes < 1 ||
        upload.maxBytes > 2 * 1024 * 1024 * 1024)
    ) {
      throw new Error(
        `Bridge field "${identity}.${name}".upload.maxBytes must be between 1 byte and 2 GiB.`
      )
    }
  }

  function normalizeUpload(type, upload = {}) {
    const kind = upload.kind || (type === 'image' ? 'image' : 'file')
    const accept = Array.isArray(upload.accept)
      ? upload.accept.map((value) => value.trim())
      : typeof upload.accept === 'string'
      ? upload.accept
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
      : kind === 'image'
      ? ['image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp']
      : []

    return {
      kind,
      storage: upload.storage || 'bridge',
      directory: readString(upload.directory) || '',
      store: upload.store || 'url',
      accept,
      maxBytes:
        upload.maxBytes ||
        (kind === 'image' ? 5 * 1024 * 1024 : 100 * 1024 * 1024)
    }
  }

  function isSafeComponentName(value) {
    return (
      typeof value === 'string' &&
      /^[A-Za-z][A-Za-z0-9]*(?:[./-][A-Za-z0-9]+)*$/.test(value) &&
      !value
        .split(/[./-]/)
        .some((part) =>
          ['__proto__', 'constructor', 'prototype'].includes(part)
        )
    )
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
      ['name', 'title', 'fullName', 'displayName', 'email', 'slug'].find(
        (name) => visibleFields.includes(name)
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
