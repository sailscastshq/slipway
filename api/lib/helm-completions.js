const EMPTY_HELM_COMPLETIONS = Object.freeze({
  version: 1,
  truncated: false,
  models: [],
  helpers: [],
  config: []
})

function collectSailsCompletionMetadata(sailsApp) {
  const metadata = {
    version: 1,
    truncated: false,
    models: [],
    helpers: [],
    config: []
  }

  if (!sailsApp || typeof sailsApp !== 'object') return metadata

  const MAX_CONFIG_DEPTH = 3
  const MAX_CONFIG_ENTRIES = 500
  const MAX_HELPER_DEPTH = 6
  const MAX_HELPER_ENTRIES = 500
  const MAX_MODELS = 100
  const MAX_MODEL_ATTRIBUTES = 1000
  const SHALLOW_CONFIG_NAMESPACES = new Set([
    'hooks',
    'paths',
    'policies',
    'routes'
  ])

  function descriptors(value) {
    try {
      return Object.getOwnPropertyDescriptors(value)
    } catch {
      return {}
    }
  }

  function dataValue(value, propertyName) {
    let current = value
    let depth = 0

    while (current && depth < 6) {
      let descriptor
      try {
        descriptor = Object.getOwnPropertyDescriptor(current, propertyName)
      } catch {
        return undefined
      }
      if (descriptor) {
        return 'value' in descriptor ? descriptor.value : undefined
      }
      try {
        current = Object.getPrototypeOf(current)
      } catch {
        return undefined
      }
      depth++
    }

    return undefined
  }

  function stringValue(value, fallback) {
    return typeof value === 'string' && value ? value : fallback
  }

  function publicNames(value) {
    return Object.keys(descriptors(value)).filter(
      (name) => name && !name.startsWith('_') && !/^\d+$/.test(name)
    )
  }

  function valueType(value) {
    if (value === null) return 'null'
    if (Array.isArray(value)) return 'array'
    try {
      if (value instanceof Date) return 'date'
    } catch {
      return 'object'
    }
    return typeof value
  }

  function isTraversable(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false
    }
    try {
      const prototype = Object.getPrototypeOf(value)
      return prototype === Object.prototype || prototype === null
    } catch {
      return false
    }
  }

  const sailsModels = dataValue(sailsApp, 'models')
  let modelAttributeEntries = 0
  if (sailsModels && typeof sailsModels === 'object') {
    for (const modelKey of publicNames(sailsModels).sort()) {
      if (metadata.models.length >= MAX_MODELS) {
        metadata.truncated = true
        break
      }
      const model = dataValue(sailsModels, modelKey)
      if (
        !model ||
        (typeof model !== 'object' && typeof model !== 'function')
      ) {
        continue
      }

      const attributes = dataValue(model, 'attributes')
      const identity = stringValue(dataValue(model, 'identity'), modelKey)
      const fallbackGlobalId = identity
        .split(/[-_\s]+/)
        .filter(Boolean)
        .map((part) => part[0].toUpperCase() + part.slice(1))
        .join('')
      const globalId = stringValue(
        dataValue(model, 'globalId'),
        fallbackGlobalId
      )
      const modelMetadata = {
        identity,
        globalId,
        attributes: []
      }

      if (attributes && typeof attributes === 'object') {
        for (const attributeName of publicNames(attributes).sort()) {
          if (modelAttributeEntries >= MAX_MODEL_ATTRIBUTES) {
            metadata.truncated = true
            break
          }
          const attribute = dataValue(attributes, attributeName)
          if (!attribute || typeof attribute !== 'object') continue

          const collection = dataValue(attribute, 'collection')
          const associationModel = dataValue(attribute, 'model')
          const type = dataValue(attribute, 'type')
          const collectionIdentity = stringValue(collection, '')
          const associationIdentity = stringValue(associationModel, '')
          modelMetadata.attributes.push({
            name: attributeName,
            type: collectionIdentity
              ? `collection:${collectionIdentity}`
              : associationIdentity
              ? `model:${associationIdentity}`
              : stringValue(type, 'ref'),
            association: collectionIdentity
              ? 'collection'
              : associationIdentity
              ? 'model'
              : null
          })
          modelAttributeEntries++
        }
      }

      metadata.models.push(modelMetadata)
    }
  }

  const sailsHelpers = dataValue(sailsApp, 'helpers')
  const helperSeen = new WeakSet()
  let helperEntries = 0

  function visitHelpers(value, path, depth) {
    if (
      !value ||
      (typeof value !== 'object' && typeof value !== 'function') ||
      depth > MAX_HELPER_DEPTH ||
      helperEntries >= MAX_HELPER_ENTRIES
    ) {
      return
    }
    if (
      (typeof value === 'object' || typeof value === 'function') &&
      helperSeen.has(value)
    ) {
      return
    }
    helperSeen.add(value)

    for (const name of publicNames(value).sort()) {
      if (helperEntries >= MAX_HELPER_ENTRIES) {
        metadata.truncated = true
        break
      }
      const child = dataValue(value, name)
      const childPath = path ? `${path}.${name}` : name

      if (typeof child === 'function') {
        metadata.helpers.push({ path: childPath })
        helperEntries++
        continue
      }

      if (child && typeof child === 'object') {
        visitHelpers(child, childPath, depth + 1)
      }
    }
  }

  visitHelpers(sailsHelpers, '', 0)

  const sailsConfig = dataValue(sailsApp, 'config')
  const configSeen = new WeakSet()
  let configEntries = 0

  function visitConfig(value, path, depth) {
    if (
      !isTraversable(value) ||
      depth > MAX_CONFIG_DEPTH ||
      configEntries >= MAX_CONFIG_ENTRIES ||
      configSeen.has(value)
    ) {
      return
    }
    configSeen.add(value)

    for (const name of publicNames(value).sort()) {
      if (configEntries >= MAX_CONFIG_ENTRIES) {
        metadata.truncated = true
        break
      }
      const child = dataValue(value, name)
      const childPath = path ? `${path}.${name}` : name

      metadata.config.push({
        path: childPath,
        type: valueType(child)
      })
      configEntries++

      const rootNamespace = childPath.split('.')[0]
      if (
        depth < MAX_CONFIG_DEPTH &&
        !SHALLOW_CONFIG_NAMESPACES.has(rootNamespace) &&
        isTraversable(child)
      ) {
        visitConfig(child, childPath, depth + 1)
      }
    }
  }

  visitConfig(sailsConfig, '', 0)

  metadata.models.sort((left, right) =>
    left.globalId.localeCompare(right.globalId)
  )
  metadata.helpers.sort((left, right) => left.path.localeCompare(right.path))
  metadata.config.sort((left, right) => left.path.localeCompare(right.path))

  return metadata
}

function buildSailsCompletionSource() {
  return `return (${collectSailsCompletionMetadata.toString()})(sails)`
}

function emptyHelmCompletions() {
  return {
    version: EMPTY_HELM_COMPLETIONS.version,
    truncated: EMPTY_HELM_COMPLETIONS.truncated,
    models: [],
    helpers: [],
    config: []
  }
}

function isHelmCompletionMetadata(value) {
  return (
    value?.version === 1 &&
    typeof value.truncated === 'boolean' &&
    Array.isArray(value.models) &&
    Array.isArray(value.helpers) &&
    Array.isArray(value.config)
  )
}

module.exports = {
  buildSailsCompletionSource,
  collectSailsCompletionMetadata,
  emptyHelmCompletions,
  isHelmCompletionMetadata
}
