module.exports = {
  friendlyName: 'Normalize Bridge resource lenses',

  description:
    'Validate named Bridge resource views, including fixed filters, columns, ordering, and optional query helpers.',

  inputs: {
    resource: {
      type: 'ref',
      required: true
    },
    lenses: {
      type: 'ref'
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ resource, lenses }) {
    if (lenses === undefined) return {}
    if (!isPlainObject(lenses)) {
      throw lensError(
        `Bridge resource "${resource.identity}".lenses must be an object.`
      )
    }

    const entries = Object.entries(lenses)
    if (entries.length > 20) {
      throw lensError(
        `Bridge resource "${resource.identity}" supports at most 20 lenses.`
      )
    }

    const allowedColumns = Object.keys(resource.attributes || {}).filter(
      (field) => {
        const attribute = resource.attributes[field]
        return (
          !attribute.encrypt &&
          !attribute.protect &&
          attribute.field?.visibility?.list !== false
        )
      }
    )
    const normalized = {}
    let defaultLens = null

    for (const [id, raw] of entries) {
      if (!isSafeSlug(id)) {
        throw lensError(
          `Bridge resource "${resource.identity}".lenses contains invalid key "${id}".`
        )
      }
      if (!isPlainObject(raw)) {
        throw lensError(
          `Bridge lens "${resource.identity}.${id}" must be an object.`
        )
      }
      rejectUnknownKeys(
        raw,
        ['label', 'filters', 'columns', 'sort', 'helper', 'default'],
        `Bridge lens "${resource.identity}.${id}"`
      )

      const label = readLabel(raw.label) || humanize(id)
      if (raw.default !== undefined && typeof raw.default !== 'boolean') {
        throw lensError(
          `Bridge lens "${resource.identity}.${id}".default must be a boolean.`
        )
      }
      if (raw.default === true) {
        if (defaultLens) {
          throw lensError(
            `Bridge resource "${resource.identity}" may define only one default lens.`
          )
        }
        defaultLens = id
      }

      const columns = normalizeColumns({
        resource,
        lensId: id,
        value: raw.columns,
        allowed: allowedColumns
      })
      const sort = normalizeSort({
        resource,
        lensId: id,
        value: raw.sort,
        allowed: columns
      })
      const fixed = await sails.helpers.bridge.normalizeResourceFilters.with({
        resource,
        filters: raw.filters || {}
      })
      const helper = normalizeHelper(resource.identity, id, raw.helper)

      normalized[id] = {
        id,
        label,
        default: raw.default === true,
        filters: fixed.filters,
        columns,
        sort,
        ...(helper ? { helper } : {})
      }
    }

    return normalized
  }
}

function normalizeColumns({ resource, lensId, value, allowed }) {
  if (value === undefined) return [...resource.list]
  if (!Array.isArray(value) || value.length === 0) {
    throw lensError(
      `Bridge lens "${resource.identity}.${lensId}".columns must be a non-empty array.`
    )
  }

  const columns = []
  for (const field of value) {
    if (typeof field !== 'string' || !allowed.includes(field)) {
      throw lensError(
        `Bridge lens "${resource.identity}.${lensId}".columns references unavailable field "${field}".`
      )
    }
    if (!columns.includes(field)) columns.push(field)
  }
  return columns
}

function normalizeSort({ resource, lensId, value, allowed }) {
  if (value === undefined) {
    const field =
      (allowed.includes(resource.sort.field) &&
      resource.attributes[resource.sort.field]?.field?.sortable !== false
        ? resource.sort.field
        : null) ||
      allowed.find(
        (candidate) => resource.attributes[candidate]?.field?.sortable !== false
      )
    if (!field) {
      throw lensError(
        `Bridge lens "${resource.identity}.${lensId}" must include a sortable column.`
      )
    }
    return {
      field,
      direction: field === resource.sort.field ? resource.sort.direction : 'ASC'
    }
  }
  if (!isPlainObject(value)) {
    throw lensError(
      `Bridge lens "${resource.identity}.${lensId}".sort must be an object.`
    )
  }
  rejectUnknownKeys(
    value,
    ['field', 'direction'],
    `Bridge lens "${resource.identity}.${lensId}".sort`
  )
  const field = value.field
  if (
    typeof field !== 'string' ||
    !allowed.includes(field) ||
    resource.attributes[field]?.field?.sortable === false
  ) {
    throw lensError(
      `Bridge lens "${resource.identity}.${lensId}".sort.field must reference a sortable lens column.`
    )
  }
  const direction = String(value.direction || 'DESC').toUpperCase()
  if (!['ASC', 'DESC'].includes(direction)) {
    throw lensError(
      `Bridge lens "${resource.identity}.${lensId}".sort.direction must be ASC or DESC.`
    )
  }
  return { field, direction }
}

function normalizeHelper(resourceIdentity, lensId, value) {
  if (value === undefined) return ''
  if (
    typeof value !== 'string' ||
    !value.split('.').every((part) => isSafeIdentifier(part))
  ) {
    throw lensError(
      `Bridge lens "${resourceIdentity}.${lensId}".helper must be a safe Sails helper identity.`
    )
  }
  return value
}

function readLabel(value) {
  if (value === undefined) return ''
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80) {
    throw lensError('Bridge lens labels must contain 1 to 80 characters.')
  }
  return value.trim()
}

function rejectUnknownKeys(value, allowed, path) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw lensError(`${path} contains unsupported option "${key}".`)
    }
  }
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
    !['__proto__', 'constructor', 'prototype'].includes(value)
  )
}

function isSafeSlug(value) {
  return (
    typeof value === 'string' &&
    /^[A-Za-z][A-Za-z0-9_-]*$/.test(value) &&
    !['__proto__', 'constructor', 'prototype'].includes(value)
  )
}

function lensError(message) {
  const error = new Error(message)
  error.code = 'BRIDGE_LENS_INVALID'
  return error
}
