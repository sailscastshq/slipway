const WATERLINE_MODEL_METHODS = [
  'addToCollection',
  'archive',
  'archiveOne',
  'avg',
  'count',
  'create',
  'createEach',
  'destroy',
  'destroyOne',
  'find',
  'findOne',
  'findOrCreate',
  'native',
  'removeFromCollection',
  'replaceCollection',
  'stream',
  'sum',
  'update',
  'updateOne',
  'validate'
]

const WATERLINE_QUERY_METHODS = [
  'eachRecord',
  'exec',
  'fetch',
  'intercept',
  'limit',
  'meta',
  'omit',
  'populate',
  'select',
  'set',
  'skip',
  'sort',
  'tolerate',
  'usingConnection',
  'where'
]

const SAILS_ROOT_OPTIONS = [
  {
    label: 'config',
    type: 'namespace',
    detail: 'Sails configuration'
  },
  {
    label: 'helpers',
    type: 'namespace',
    detail: 'Sails helpers'
  },
  {
    label: 'models',
    type: 'namespace',
    detail: 'Waterline models'
  },
  {
    label: 'getDatastore',
    type: 'function',
    detail: 'Sails datastore'
  },
  {
    label: 'getRouteFor',
    type: 'function',
    detail: 'Sails route metadata'
  },
  {
    label: 'getUrlFor',
    type: 'function',
    detail: 'Sails route URL'
  },
  {
    label: 'hooks',
    type: 'namespace',
    detail: 'Loaded Sails hooks'
  },
  {
    label: 'log',
    type: 'namespace',
    detail: 'Sails logger'
  },
  {
    label: 'sendNativeQuery',
    type: 'function',
    detail: 'Native datastore query'
  }
]

function normalizeMetadata(metadata) {
  return {
    models: Array.isArray(metadata?.models) ? metadata.models : [],
    helpers: Array.isArray(metadata?.helpers) ? metadata.helpers : [],
    config: Array.isArray(metadata?.config) ? metadata.config : []
  }
}

function pathOptions(entries, typedPath, leafType, leafDetail) {
  const pieces = typedPath.split('.')
  const typed = pieces.pop() || ''
  const parent = pieces.join('.')
  const parentPrefix = parent ? `${parent}.` : ''
  const candidates = new Map()

  for (const entry of entries) {
    const path = entry.path
    if (typeof path !== 'string' || !path.startsWith(parentPrefix)) continue

    const relativePath = path.slice(parentPrefix.length)
    if (!relativePath) continue

    const [label, ...remaining] = relativePath.split('.')
    const existing = candidates.get(label)
    const isNamespace = remaining.length > 0

    if (!existing || isNamespace) {
      candidates.set(label, {
        label,
        type: isNamespace ? 'namespace' : leafType,
        detail: isNamespace
          ? `${leafDetail} namespace`
          : entry.type
          ? `${entry.type} · ${leafDetail}`
          : leafDetail
      })
    }
  }

  return {
    typed,
    options: [...candidates.values()].sort((left, right) =>
      left.label.localeCompare(right.label)
    )
  }
}

function attributeOptions(model) {
  return (Array.isArray(model?.attributes) ? model.attributes : []).map(
    (attribute) => ({
      label: attribute.name,
      type: 'property',
      detail: `${attribute.type || 'ref'} · model attribute`
    })
  )
}

function methodOptions(methods, detail) {
  return methods.map((label) => ({
    label,
    type: 'function',
    detail
  }))
}

function findLatestModel(source, models) {
  let latest = null

  for (const model of models) {
    if (!model?.globalId) continue
    const index = source.lastIndexOf(`${model.globalId}.`)
    if (index === -1 || (latest && index <= latest.index)) continue
    latest = { model, index }
  }

  return latest
}

function completion(from, options) {
  if (!options.length) return null
  return {
    from,
    options,
    validFor: /^[A-Za-z0-9_$]*$/
  }
}

export function helmCompletionResult(
  source,
  cursor,
  metadata,
  { explicit = false } = {}
) {
  const normalized = normalizeMetadata(metadata)
  const before = String(source || '').slice(0, cursor)
  let match

  match = before.match(/sails\.helpers\.([A-Za-z0-9_$.]*)$/)
  if (match) {
    const resolved = pathOptions(
      normalized.helpers,
      match[1],
      'function',
      'Sails helper'
    )
    return completion(cursor - resolved.typed.length, resolved.options)
  }

  match = before.match(/sails\.config\.([A-Za-z0-9_$.]*)$/)
  if (match) {
    const resolved = pathOptions(
      normalized.config,
      match[1],
      'property',
      'Sails config'
    )
    return completion(cursor - resolved.typed.length, resolved.options)
  }

  match = before.match(/sails\.models\.([A-Za-z0-9_$]*)$/)
  if (match) {
    return completion(
      cursor - match[1].length,
      normalized.models.map((model) => ({
        label: model.identity,
        type: 'class',
        detail: `${model.globalId} · Waterline model`
      }))
    )
  }

  match = before.match(/sails\.([A-Za-z0-9_$]*)$/)
  if (match) {
    return completion(cursor - match[1].length, SAILS_ROOT_OPTIONS)
  }

  for (const model of normalized.models) {
    const escapedGlobalId = model.globalId.replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&'
    )
    match = before.match(
      new RegExp(`${escapedGlobalId}\\.attributes\\.([A-Za-z0-9_$]*)$`)
    )
    if (match) {
      return completion(cursor - match[1].length, attributeOptions(model))
    }
  }

  const latestModel = findLatestModel(before, normalized.models)
  if (latestModel) {
    const modelSource = before.slice(latestModel.index)
    const queryStarted =
      /\.(?:find|findOne|findOrCreate|update|updateOne|destroy|destroyOne|count|sum|avg)\s*\(/.test(
        modelSource
      )

    if (queryStarted) {
      match = before.match(
        /(?:select|omit|sort|sum|avg)\s*\([^)]*['"]([A-Za-z0-9_$]*)$/
      )
      if (match) {
        return completion(
          cursor - match[1].length,
          attributeOptions(latestModel.model)
        )
      }

      match = before.match(/(?:\{|,)\s*([A-Za-z_$][A-Za-z0-9_$]*)?$/)
      if (match && (explicit || match[1])) {
        const typed = match[1] || ''
        return completion(
          cursor - typed.length,
          attributeOptions(latestModel.model)
        )
      }

      match = before.match(/\.([A-Za-z0-9_$]*)$/)
      if (match) {
        return completion(
          cursor - match[1].length,
          methodOptions(WATERLINE_QUERY_METHODS, 'Waterline query modifier')
        )
      }
    }

    const directModelMatch = modelSource.match(
      new RegExp(
        `^${latestModel.model.globalId.replace(
          /[.*+?^${}()|[\]\\]/g,
          '\\$&'
        )}\\.([A-Za-z0-9_$]*)$`
      )
    )
    if (directModelMatch) {
      return completion(cursor - directModelMatch[1].length, [
        ...methodOptions(WATERLINE_MODEL_METHODS, 'Waterline model method'),
        {
          label: 'attributes',
          type: 'property',
          detail: 'Waterline model attributes'
        },
        {
          label: 'primaryKey',
          type: 'property',
          detail: 'Waterline model metadata'
        }
      ])
    }
  }

  match = before.match(/([A-Za-z_$][A-Za-z0-9_$]*)$/)
  if (!match) {
    if (!explicit) return null
    match = ['', '']
  }

  const typed = match[1] || ''
  if (!explicit && (!typed || !/^[A-Z]/.test(typed))) return null

  return completion(cursor - typed.length, [
    ...normalized.models.map((model) => ({
      label: model.globalId,
      type: 'class',
      detail: `${model.identity} · Waterline model`
    })),
    {
      label: 'sails',
      type: 'variable',
      detail: 'Sails application'
    }
  ])
}

export function createHelmCompletionSource(metadata) {
  return (context) =>
    helmCompletionResult(
      context.state.sliceDoc(0, context.pos),
      context.pos,
      metadata,
      { explicit: context.explicit }
    )
}

export { WATERLINE_MODEL_METHODS, WATERLINE_QUERY_METHODS }
