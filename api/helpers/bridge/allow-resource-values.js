module.exports = {
  friendlyName: 'Allow Bridge resource values',

  description:
    'Allowlist a Bridge mutation payload against a normalized resource surface.',

  inputs: {
    values: {
      type: 'ref',
      required: true
    },
    resource: {
      type: 'ref',
      required: true
    },
    surface: {
      type: 'string',
      required: true,
      isIn: ['create', 'edit']
    },
    uploadContext: {
      type: 'ref',
      description:
        'Authorized actor and resource context used to verify Bridge upload receipts.'
    },
    validateOnly: {
      type: 'json',
      defaultsTo: [],
      description: 'Optional Bridge field names to validate from the payload.'
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({
    values,
    resource,
    surface,
    uploadContext,
    validateOnly
  }) {
    if (
      !values ||
      typeof values !== 'object' ||
      Array.isArray(values) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(values))
    ) {
      const error = new Error('Record values must be a plain object.')
      error.code = 'INVALID_BRIDGE_VALUES'
      throw error
    }

    const allowedFields = new Set(
      (resource?.[surface] || []).filter((field) => {
        const attribute = resource?.attributes?.[field]
        return (
          attribute &&
          (field !== resource.primaryKey || surface === 'create') &&
          !attribute.protect &&
          !attribute.autoCreatedAt &&
          !attribute.autoUpdatedAt &&
          attribute.field?.readOnly !== true
        )
      })
    )
    const allowedValues = {}
    const rejectedFields = []
    const unsafeMarkdownFields = []
    const fieldErrors = {}
    const requestedFields = validateOnly.length
      ? Array.from(new Set(validateOnly))
      : Object.keys(values)

    for (const key of requestedFields) {
      if (
        !allowedFields.has(key) ||
        ['__proto__', 'constructor', 'prototype'].includes(key)
      ) {
        rejectedFields.push(key)
        continue
      }

      const attribute = resource.attributes[key]
      const association = (resource.associations || []).find(
        (candidate) => candidate.type === 'model' && candidate.alias === key
      )
      const type = attribute.field?.type || attribute.type || 'text'
      if (
        type === 'richtext' &&
        attribute.field?.format?.toLowerCase() === 'markdown' &&
        containsRawHtml(values[key])
      ) {
        unsafeMarkdownFields.push(key)
        continue
      }

      try {
        if (association || type === 'belongsTo') {
          allowedValues[key] =
            await sails.helpers.bridge.normalizeIdentifier.with({
              value: values[key],
              attribute: {
                type: association?.primaryKeyType || attribute.type,
                maxLength: attribute.maxLength
              },
              allowNull: !attribute.required,
              label: `Bridge field "${resource.identity}.${key}"`
            })
          continue
        }

        if (['file', 'image', 'upload'].includes(type)) {
          allowedValues[key] =
            await sails.helpers.bridge.verifyUploadReceipt.with({
              receipt: values[key]?.receipt,
              url: values[key]?.url,
              context: {
                ...uploadContext,
                resource: resource.identity,
                field: key
              }
            })
          continue
        }

        allowedValues[key] = normalizeFieldValue({
          value: values[key],
          attribute,
          type,
          field: attribute.field,
          label: attribute.label || key
        })
      } catch (error) {
        if (error.code === 'BRIDGE_INVALID_IDENTIFIER') throw error
        fieldErrors[key] = error.message
      }
    }

    if (surface === 'create') {
      for (const key of allowedFields) {
        if (validateOnly.length && !validateOnly.includes(key)) continue
        const attribute = resource.attributes[key]
        if (
          attribute.required === true &&
          values[key] === undefined &&
          attribute.defaultsTo === undefined &&
          attribute.field?.default === undefined
        ) {
          fieldErrors[key] = `${attribute.label || key} is required.`
        }
      }
    }

    if (rejectedFields.length > 0) {
      const error = new Error(
        `These fields are not available in Bridge: ${rejectedFields.join(
          ', '
        )}.`
      )
      error.code = 'BRIDGE_FIELD_NOT_ALLOWED'
      error.fields = rejectedFields
      throw error
    }

    if (unsafeMarkdownFields.length > 0) {
      const error = new Error(
        `Raw HTML is not allowed in Bridge Markdown fields: ${unsafeMarkdownFields.join(
          ', '
        )}.`
      )
      error.code = 'BRIDGE_MARKDOWN_HTML_NOT_ALLOWED'
      error.fields = unsafeMarkdownFields
      throw error
    }

    if (Object.keys(fieldErrors).length > 0) {
      const error = new Error('Some Bridge fields are invalid.')
      error.code = 'BRIDGE_FIELD_INVALID'
      error.fields = Object.keys(fieldErrors)
      error.fieldErrors = fieldErrors
      throw error
    }

    return allowedValues
  }
}

function normalizeFieldValue({ value, attribute, type, field, label }) {
  if (
    (value === '' || value === null || value === undefined) &&
    !attribute.required
  ) {
    if (['text', 'textarea', 'richtext', 'email', 'url'].includes(type)) {
      return value === null || value === undefined ? '' : value
    }
    return null
  }

  if (value === undefined || value === null || value === '') {
    throw new Error(`${label} is required.`)
  }

  if (type === 'boolean') {
    if (typeof value !== 'boolean') {
      throw new Error(`${label} must be true or false.`)
    }
    return value
  }

  if (type === 'json') {
    let parsed = value
    if (typeof value === 'string') {
      try {
        parsed = JSON.parse(value)
      } catch {
        throw new Error(`${label} must contain valid JSON.`)
      }
    }
    try {
      JSON.stringify(parsed)
    } catch {
      throw new Error(`${label} must contain valid JSON.`)
    }
    return parsed
  }

  if (type === 'number' || type === 'currency') {
    const number = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(number)) {
      throw new Error(`${label} must be a number.`)
    }
    const min = attribute.min ?? attribute.validations?.min
    const max = attribute.max ?? attribute.validations?.max
    if (min !== undefined && min !== null && number < min) {
      throw new Error(`${label} must be at least ${min}.`)
    }
    if (max !== undefined && max !== null && number > max) {
      throw new Error(`${label} must be at most ${max}.`)
    }
    if (type === 'currency' && field?.currency?.submit === 'minor') {
      const digits = field.currency.maximumFractionDigits ?? 2
      return Math.round(number * 10 ** digits)
    }
    return number
  }

  if (type === 'select') {
    const options = field?.options || []
    if (
      options.length > 0 &&
      !options.some(
        (option) => option.disabled !== true && Object.is(option.value, value)
      )
    ) {
      throw new Error(`${label} must use one of the available options.`)
    }
    return value
  }

  if (type === 'email') {
    const email = requireString(value, label)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error(`${label} must be a valid email address.`)
    }
    return email
  }

  if (type === 'url') {
    const url = requireString(value, label)
    let parsed
    try {
      parsed = new URL(url)
    } catch {
      throw new Error(`${label} must be a valid URL.`)
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`${label} must use HTTP or HTTPS.`)
    }
    return parsed.toString()
  }

  if (type === 'date') {
    const date = requireString(value, label)
    if (!isValidDateOnly(date)) {
      throw new Error(`${label} must be a valid date.`)
    }
    return attribute.type === 'number'
      ? Date.parse(`${date}T00:00:00.000Z`)
      : date
  }

  if (['datetime', 'timestamp'].includes(type)) {
    const timestamp =
      typeof value === 'number'
        ? value
        : Date.parse(requireString(value, label))
    if (!Number.isFinite(timestamp)) {
      throw new Error(`${label} must be a valid date and time.`)
    }
    return attribute.type === 'number'
      ? timestamp
      : new Date(timestamp).toISOString()
  }

  const string = requireString(value, label)
  const minLength = attribute.minLength ?? attribute.validations?.minLength
  const maxLength = attribute.maxLength ?? attribute.validations?.maxLength
  if (minLength && string.length < minLength) {
    throw new Error(`${label} must contain at least ${minLength} characters.`)
  }
  if (maxLength && string.length > maxLength) {
    throw new Error(`${label} must contain at most ${maxLength} characters.`)
  }
  return string
}

function requireString(value, label) {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be text.`)
  }
  return value
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

function containsRawHtml(value) {
  if (typeof value !== 'string') return false

  const withoutAutolinks = value.replace(
    /<[a-z][a-z\d+.-]{1,31}:[^<>\s]*>|<[a-z\d.!#$%&'*+/=?^_`{|}~-]+@[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?)+>/gi,
    ''
  )

  return /<!--[\s\S]*?-->|<\/?[a-z][^<>]*>|<![A-Z][^>]*>|<\?[\s\S]*?\?>/i.test(
    withoutAutolinks
  )
}
