const TEXT_TYPES = new Set([
  'text',
  'textarea',
  'richtext',
  'email',
  'url',
  'password',
  'secret'
])

export function bridgeFieldType(attribute = {}) {
  return attribute.field?.type || attribute.type || 'text'
}

export function toBridgeFieldInputValue(attribute, value) {
  const type = bridgeFieldType(attribute)
  const defaultValue = attribute.field?.default ?? attribute.defaultsTo
  const resolved = value === undefined ? defaultValue : value

  if (type === 'boolean') return Boolean(resolved ?? false)
  if (type === 'json') {
    if (resolved === undefined || resolved === null) return ''
    return typeof resolved === 'string'
      ? resolved
      : JSON.stringify(resolved, null, 2)
  }
  if (type === 'date') return toDateInputValue(resolved)
  if (['datetime', 'timestamp'].includes(type)) {
    return toDateTimeInputValue(resolved)
  }
  return resolved ?? ''
}

export function validateBridgeFieldValue({ attribute, value, isEdit = false }) {
  const type = bridgeFieldType(attribute)
  if (isEdit && ['password', 'secret'].includes(type) && value === '') return ''
  if (['file', 'image', 'upload'].includes(type)) {
    if (!attribute.required || value?.receipt || typeof value === 'string') {
      return ''
    }
    return `${attribute.label || 'This file'} is required.`
  }

  if (attribute.required && isEmpty(value, type)) {
    return `${attribute.label || 'This field'} is required.`
  }
  if (isEmpty(value, type)) return ''

  if (type === 'json') {
    try {
      JSON.parse(value)
    } catch {
      return `${attribute.label || 'This field'} must contain valid JSON.`
    }
  }
  if (
    ['number', 'currency'].includes(type) &&
    !Number.isFinite(Number(value))
  ) {
    return `${attribute.label || 'This field'} must be a number.`
  }
  if (['number', 'currency'].includes(type)) {
    const number = Number(value)
    const min = attribute.min ?? attribute.validations?.min
    const max = attribute.max ?? attribute.validations?.max
    if (min !== undefined && min !== null && number < min) {
      return `${attribute.label || 'This field'} must be at least ${min}.`
    }
    if (max !== undefined && max !== null && number > max) {
      return `${attribute.label || 'This field'} must be at most ${max}.`
    }
  }
  if (type === 'select') {
    const options = bridgeSelectOptions(attribute)
    if (
      options.length > 0 &&
      !options.some(
        (option) => option.disabled !== true && Object.is(option.value, value)
      )
    ) {
      return `${
        attribute.label || 'This field'
      } must use one of the available options.`
    }
  }
  if (type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return `${attribute.label || 'This field'} must be a valid email address.`
  }
  if (type === 'url') {
    try {
      const url = new URL(value)
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error()
    } catch {
      return `${
        attribute.label || 'This field'
      } must be a valid HTTP or HTTPS URL.`
    }
  }
  if (type === 'date' && !isValidDateOnly(value)) {
    return `${attribute.label || 'This field'} must be a valid date.`
  }
  if (
    ['datetime', 'timestamp'].includes(type) &&
    Number.isNaN(new Date(value).getTime())
  ) {
    return `${attribute.label || 'This field'} must be a valid date and time.`
  }
  if (TEXT_TYPES.has(type)) {
    const length = String(value).length
    const minLength = attribute.minLength ?? attribute.validations?.minLength
    const maxLength = attribute.maxLength ?? attribute.validations?.maxLength
    if (minLength && length < minLength) {
      return `${
        attribute.label || 'This field'
      } must contain at least ${minLength} characters.`
    }
    if (maxLength && length > maxLength) {
      return `${
        attribute.label || 'This field'
      } must contain at most ${maxLength} characters.`
    }
  }
  return ''
}

export function prepareBridgeFieldSubmission({
  attribute,
  value,
  isEdit = false
}) {
  const type = bridgeFieldType(attribute)

  if (isEdit && ['password', 'secret'].includes(type) && value === '') {
    return { include: false }
  }
  if (['file', 'image', 'upload'].includes(type)) {
    return value?.receipt
      ? { include: true, value: { url: value.url, receipt: value.receipt } }
      : { include: false }
  }
  if (type === 'json' && typeof value === 'string' && value.trim()) {
    return { include: true, value: JSON.parse(value) }
  }
  if (['number', 'currency'].includes(type) && value !== '' && value !== null) {
    return { include: true, value: Number(value) }
  }
  if (
    ['datetime', 'timestamp'].includes(type) &&
    typeof value === 'string' &&
    value
  ) {
    return { include: true, value: new Date(value).toISOString() }
  }
  if (value === '' && !attribute.required && !TEXT_TYPES.has(type)) {
    return { include: true, value: null }
  }
  return { include: true, value }
}

export function bridgeSelectOptions(attribute = {}) {
  const configured = attribute.field?.options
  if (Array.isArray(configured)) return configured
  const inferred = attribute.isIn || attribute.validations?.isIn || []
  return inferred.map((value) => ({
    label: String(value),
    value,
    disabled: false
  }))
}

export function formatBridgeFieldValue(
  value,
  attribute = {},
  context = 'show'
) {
  const type = bridgeFieldType(attribute)
  if (value === null || value === undefined) {
    return { kind: 'null', display: 'null' }
  }
  if (type === 'boolean') {
    return { kind: 'boolean', display: value ? 'Yes' : 'No', value: !!value }
  }
  if (type === 'currency') {
    const currency = attribute.field?.currency || {}
    const number = Number(value)
    if (!Number.isFinite(number))
      return { kind: 'text', display: String(value) }
    try {
      return {
        kind: 'currency',
        display: new Intl.NumberFormat(currency.locale || 'en-US', {
          style: 'currency',
          currency: currency.code || 'USD',
          minimumFractionDigits: currency.minimumFractionDigits ?? 2,
          maximumFractionDigits: currency.maximumFractionDigits ?? 2
        }).format(number)
      }
    } catch {
      return { kind: 'text', display: String(value) }
    }
  }
  if (['date', 'datetime', 'timestamp'].includes(type)) {
    const date = new Date(
      type === 'date' && typeof value === 'string' ? `${value}T00:00:00` : value
    )
    if (!Number.isNaN(date.getTime())) {
      return {
        kind: 'date',
        display:
          type === 'date'
            ? date.toLocaleDateString(undefined, { dateStyle: 'medium' })
            : date.toLocaleString(undefined, {
                dateStyle: context === 'list' ? 'medium' : 'long',
                timeStyle: context === 'list' ? 'short' : 'medium'
              })
      }
    }
  }
  if (type === 'json' || typeof value === 'object') {
    return {
      kind: 'json',
      display: JSON.stringify(value, null, context === 'list' ? 0 : 2)
    }
  }
  if (['image'].includes(type) || attribute.field?.upload?.kind === 'image') {
    return {
      kind: 'image',
      display: String(value),
      url: safeBridgeHttpUrl(value)
    }
  }
  if (['file', 'upload'].includes(type)) {
    return {
      kind: 'file',
      display: fileNameFromUrl(value),
      url: safeBridgeHttpUrl(value)
    }
  }
  if (type === 'url') {
    return {
      kind: 'url',
      display: String(value),
      url: safeBridgeHttpUrl(value)
    }
  }
  if (type === 'email') {
    return { kind: 'email', display: String(value), email: String(value) }
  }

  const string = String(value)
  return {
    kind: type === 'richtext' || type === 'textarea' ? 'longtext' : 'text',
    display:
      context === 'list' && string.length > 60
        ? `${string.slice(0, 60)}…`
        : string
  }
}

export function formatBridgeBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes >= 1024 * 1024 * 1024) {
    return `${Math.round(bytes / (1024 * 1024 * 1024))} GB`
  }
  if (bytes >= 1024 * 1024) {
    return `${Math.round(bytes / (1024 * 1024))} MB`
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function isEmpty(value, type) {
  if (type === 'boolean') return typeof value !== 'boolean'
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim() === '')
  )
}

function toDateInputValue(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10)
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-')
}

function isValidDateOnly(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const [, year, month, day] = match.map(Number)
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

function toDateTimeInputValue(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

export function safeBridgeHttpUrl(value) {
  try {
    const url = new URL(String(value))
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null
  } catch {
    return null
  }
}

function fileNameFromUrl(value) {
  try {
    const url = new URL(String(value))
    return decodeURIComponent(url.pathname.split('/').pop()) || 'Download file'
  } catch {
    return 'Download file'
  }
}
