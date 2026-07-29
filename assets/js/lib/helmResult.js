const TYPED_SCALAR_TYPES = new Set([
  'BigInt',
  'Date',
  'Function',
  'Number',
  'Symbol',
  'undefined'
])

function isObject(value) {
  return value !== null && typeof value === 'object'
}

export function isTypedHelmScalar(value) {
  return (
    isObject(value) &&
    typeof value.type === 'string' &&
    TYPED_SCALAR_TYPES.has(value.type)
  )
}

export function isHelmBranch(value) {
  return isObject(value) && !isTypedHelmScalar(value)
}

export function isHelmTableValue(value) {
  if (!Array.isArray(value) || value.length === 0) return false

  const firstColumns = Object.keys(value[0] || {})
  if (firstColumns.length === 0) return false
  const stableColumns = [...firstColumns].sort().join('\u0000')

  return value.every((row) => {
    if (!isObject(row) || Array.isArray(row) || isTypedHelmScalar(row)) {
      return false
    }

    if ([...Object.keys(row)].sort().join('\u0000') !== stableColumns) {
      return false
    }

    return firstColumns.every((column) => !isHelmBranch(row[column]))
  })
}

export function helmTableColumns(value) {
  return isHelmTableValue(value) ? Object.keys(value[0]) : []
}

export function serializeHelmValue(value) {
  const serialized = JSON.stringify(value, null, 2)
  return serialized === undefined ? 'undefined' : serialized
}

export function rawHelmValue(value) {
  if (typeof value === 'string') return value
  if (isTypedHelmScalar(value) && value.type === 'undefined') return 'undefined'
  return serializeHelmValue(value)
}

export function helmScalarPresentation(value) {
  if (value === null) {
    return { text: 'NULL', type: 'null', title: 'null' }
  }

  if (isTypedHelmScalar(value)) {
    if (value.type === 'undefined') {
      return { text: 'undefined', type: 'undefined', title: 'undefined' }
    }

    const text =
      value.type === 'BigInt'
        ? `${value.value}n`
        : value.type === 'Function'
        ? `[Function ${value.name || 'anonymous'}]`
        : value.type === 'Symbol'
        ? `Symbol(${value.value || ''})`
        : String(value.value)

    return {
      text,
      type: value.type.toLowerCase(),
      title: text,
      datetime: value.type === 'Date' ? value.value : undefined
    }
  }

  if (typeof value === 'string') {
    return { text: value, type: 'string', title: value }
  }
  if (typeof value === 'number') {
    return { text: String(value), type: 'number', title: String(value) }
  }
  if (typeof value === 'boolean') {
    return { text: String(value), type: 'boolean', title: String(value) }
  }
  if (value === undefined) {
    return { text: 'undefined', type: 'undefined', title: 'undefined' }
  }

  const text = serializeHelmValue(value)
  return { text, type: 'object', title: text }
}

export function formatHelmError(error, fallback = 'Execution failed') {
  if (!error) return fallback
  if (typeof error === 'string') return error

  const location =
    error.line && error.column ? ` (${error.line}:${error.column})` : ''
  return `${error.name || 'Error'}: ${error.message || fallback}${location}`
}

export function helmRowsToCsv(rows, columns) {
  return [
    columns.map(csvCell).join(','),
    ...rows.map((row) =>
      columns.map((column) => csvCell(row[column])).join(',')
    )
  ].join('\n')
}

function csvCell(value) {
  const presentation = helmScalarPresentation(value)
  let text = presentation.type === 'null' ? '' : presentation.text

  // Prevent spreadsheet applications from interpreting returned text as a
  // formula when the exported CSV is opened.
  if (presentation.type === 'string' && /^[\t\r ]*[=+\-@]/.test(text)) {
    text = `'${text}`
  }

  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}
