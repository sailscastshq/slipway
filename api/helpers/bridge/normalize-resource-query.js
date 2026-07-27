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
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ resource, page, perPage, sort, search }) {
    const safePage = Math.max(1, Math.floor(page || 1))
    const safePerPage = Math.min(100, Math.max(1, Math.floor(perPage || 20)))
    const primaryKey = resource.primaryKey || 'id'
    const selectable = Array.from(
      new Set([primaryKey, ...(resource.list || [])])
    ).filter((field) => resource.attributes?.[field])
    const sortable = new Set(
      selectable.filter(
        (field) => resource.attributes[field]?.field?.sortable !== false
      )
    )

    let sortField = resource.sort?.field || primaryKey
    let sortDirection = resource.sort?.direction || 'DESC'
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
    const where =
      searchValue && searchFields.length > 0
        ? {
            or: searchFields.map((field) => ({
              [field]: { contains: searchValue }
            }))
          }
        : {}

    return {
      page: safePage,
      perPage: safePerPage,
      search: searchValue,
      sort: `${sortField} ${sortDirection}`,
      select: selectable,
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
