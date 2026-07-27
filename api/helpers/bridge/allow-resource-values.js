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
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ values, resource, surface }) {
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
          field !== resource.primaryKey &&
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

    for (const key of Object.keys(values)) {
      if (
        !allowedFields.has(key) ||
        ['__proto__', 'constructor', 'prototype'].includes(key)
      ) {
        rejectedFields.push(key)
        continue
      }

      const attribute = resource.attributes[key]
      if (
        attribute.field?.type === 'richtext' &&
        attribute.field?.format?.toLowerCase() === 'markdown' &&
        containsRawHtml(values[key])
      ) {
        unsafeMarkdownFields.push(key)
        continue
      }

      allowedValues[key] = values[key]
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

    return allowedValues
  }
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
