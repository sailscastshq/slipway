const MAX_CONTENT_BYTES = 5 * 1024 * 1024

module.exports = {
  friendlyName: 'Validate content values',

  description:
    'Validate Content Manager create and editor values before source mutation.',

  inputs: {
    values: {
      type: 'ref',
      required: true
    },
    validateOnly: {
      type: 'json',
      defaultsTo: []
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  sync: true,

  fn: function ({ values, validateOnly }) {
    const problems = []

    function shouldValidate(field) {
      if (!validateOnly.length) return true
      return validateOnly.some(
        (requested) =>
          requested === field ||
          requested.startsWith(`${field}.`) ||
          field.startsWith(`${requested}.`)
      )
    }

    function add(field, message) {
      problems.push({ [field]: message })
    }

    if (shouldValidate('contentSlug') && values.contentSlug !== undefined) {
      const slug = String(values.contentSlug).trim()
      if (!slug) {
        add('contentSlug', 'Enter a content slug.')
      } else if (slug.length > 120) {
        add('contentSlug', 'Content slug must be 120 characters or less.')
      } else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
        add(
          'contentSlug',
          'Use lowercase letters, numbers, and single hyphens.'
        )
      }
    }

    if (shouldValidate('title') && values.title !== undefined) {
      const title = String(values.title)
      if (title.length > 200) {
        add('title', 'Title must be 200 characters or less.')
      } else if (/\0/.test(title)) {
        add('title', 'Title contains an unsupported character.')
      }
    }

    if (shouldValidate('frontmatter') && values.frontmatter !== undefined) {
      const frontmatter = values.frontmatter
      if (!isPlainObject(frontmatter)) {
        add('frontmatter', 'Metadata must be key-value pairs.')
      } else if (Object.keys(frontmatter).length > 100) {
        add('frontmatter', 'Metadata cannot contain more than 100 fields.')
      } else {
        const requestedKeys = validateOnly
          .filter((field) => field.startsWith('frontmatter.'))
          .map((field) => field.slice('frontmatter.'.length))
        const entries = requestedKeys.length
          ? requestedKeys
              .filter((key) => Object.hasOwn(frontmatter, key))
              .map((key) => [key, frontmatter[key]])
          : Object.entries(frontmatter)
        for (const [key, value] of entries) {
          if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key)) {
            add(`frontmatter.${key}`, 'Use a valid metadata field name.')
            continue
          }
          try {
            const serialized = JSON.stringify(value)
            if (serialized === undefined) throw new Error('not serializable')
          } catch {
            add(`frontmatter.${key}`, 'Enter a serializable metadata value.')
          }
        }
      }
    }

    if (shouldValidate('body') && values.body !== undefined) {
      if (typeof values.body !== 'string') {
        add('body', 'Content body must be text.')
      } else if (Buffer.byteLength(values.body, 'utf8') > MAX_CONTENT_BYTES) {
        add('body', 'Content body must be 5 MB or less.')
      }
    }

    if (shouldValidate('raw') && values.raw !== undefined) {
      if (typeof values.raw !== 'string') {
        add('raw', 'Source must be text.')
      } else if (Buffer.byteLength(values.raw, 'utf8') > MAX_CONTENT_BYTES) {
        add('raw', 'Source must be 5 MB or less.')
      } else if (values.fileType === 'json') {
        try {
          JSON.parse(values.raw)
        } catch {
          add('raw', 'Enter valid JSON before saving.')
        }
      }
    }

    return problems
  }
}

function isPlainObject(value) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
}
