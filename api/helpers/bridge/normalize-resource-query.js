module.exports = {
  friendlyName: 'Normalize Bridge resource query',

  description:
    'Build safe Waterline pagination, search, selection, and sort criteria from a normalized Bridge resource.',

  inputs: {
    resource: {
      type: 'ref',
      required: true
    },
    page: {
      type: 'number',
      defaultsTo: 1
    },
    perPage: {
      type: 'number',
      defaultsTo: 20
    },
    sort: {
      type: 'string',
      defaultsTo: ''
    },
    search: {
      type: 'string',
      defaultsTo: ''
    },
    filters: {
      type: 'ref',
      defaultsTo: {}
    },
    lens: {
      type: 'string',
      defaultsTo: ''
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({
    resource,
    page,
    perPage,
    sort,
    search,
    filters,
    lens
  }) {
    const safePage = Math.max(1, Math.floor(page || 1))
    const safePerPage = Math.min(100, Math.max(1, Math.floor(perPage || 20)))
    const primaryKey = resource.primaryKey || 'id'
    const requestedLens = String(lens || '').trim()
    const defaultLens = Object.values(resource.lenses || {}).find(
      (definition) => definition.default
    )
    const activeLens =
      requestedLens === '__all'
        ? null
        : requestedLens
        ? resource.lenses?.[requestedLens]
        : defaultLens || null
    if (requestedLens && requestedLens !== '__all' && !activeLens) {
      const error = new Error(`Bridge lens "${requestedLens}" is unavailable.`)
      error.code = 'BRIDGE_LENS_INVALID'
      throw error
    }

    const columns = activeLens?.columns || resource.list || []
    const selectable = Array.from(new Set([primaryKey, ...columns])).filter(
      (field) => resource.attributes?.[field]
    )
    const sortable = new Set(
      columns.filter(
        (field) => resource.attributes[field]?.field?.sortable !== false
      )
    )

    const defaultSort = activeLens?.sort || resource.sort
    let sortField = defaultSort?.field || primaryKey
    let sortDirection = defaultSort?.direction || 'DESC'
    const requestedSort = String(sort || '').trim()
    if (requestedSort) {
      const match = requestedSort.match(
        /^([A-Za-z][A-Za-z0-9_]*)\s+(ASC|DESC)$/i
      )
      if (match && sortable.has(match[1])) {
        sortField = match[1]
        sortDirection = match[2].toUpperCase()
      }
    }

    const searchValue = String(search || '')
      .trim()
      .slice(0, 200)
    const searchFields = (resource.search || []).filter(
      (field) =>
        resource.attributes?.[field]?.type === 'string' &&
        !resource.attributes[field].encrypt &&
        !resource.attributes[field].protect
    )
    const searchWhere =
      searchValue && searchFields.length > 0
        ? {
            or: searchFields.map((field) => ({
              [field]: { contains: searchValue }
            }))
          }
        : {}
    const fixedFilters =
      await sails.helpers.bridge.normalizeResourceFilters.with({
        resource,
        filters: activeLens?.filters || {}
      })
    const activeFilters =
      await sails.helpers.bridge.normalizeResourceFilters.with({
        resource,
        filters
      })
    const where = combineWhere([
      searchWhere,
      fixedFilters.where,
      activeFilters.where
    ])

    return {
      page: safePage,
      perPage: safePerPage,
      search: searchValue,
      sort: `${sortField} ${sortDirection}`,
      select: selectable,
      columns,
      filters: activeFilters.filters,
      filterDefinitions: activeFilters.definitions,
      lens: activeLens,
      where,
      criteria: {
        where,
        skip: (safePage - 1) * safePerPage,
        limit: safePerPage,
        sort: `${sortField} ${sortDirection}`,
        select: selectable
      }
    }
  }
}

function combineWhere(clauses) {
  const present = clauses.filter(
    (clause) => clause && Object.keys(clause).length > 0
  )
  if (present.length === 0) return {}
  if (present.length === 1) return present[0]
  return { and: present }
}
