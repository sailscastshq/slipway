const TOKEN_PATTERN =
  /\{([A-Za-z][A-Za-z0-9]*)(?:\.([A-Za-z][A-Za-z0-9]*))?(\|slug)?\}/g

module.exports = {
  friendlyName: 'Resolve Bridge upload object path',

  description:
    'Resolve an authorized upload path template from record and relationship values.',

  inputs: {
    containerName: {
      type: 'string',
      required: true
    },
    resource: {
      type: 'ref',
      required: true
    },
    resources: {
      type: 'ref',
      required: true
    },
    upload: {
      type: 'ref',
      required: true
    },
    values: {
      type: 'ref',
      defaultsTo: {}
    },
    recordId: {
      type: 'ref'
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({
    containerName,
    resource,
    resources,
    upload,
    values,
    recordId
  }) {
    const directoryTemplate = upload.directory || ''
    const filenameTemplate = upload.filename || ''
    const references = uniqueReferences([
      ...readReferences(directoryTemplate),
      ...readReferences(filenameTemplate)
    ])

    if (references.length === 0) {
      return {
        directory: directoryTemplate,
        filename: filenameTemplate
      }
    }

    const definitions = references.map((reference) =>
      describeReference({ reference, resource, resources })
    )
    const directFields = definitions
      .filter(({ relation }) => !relation)
      .map(({ field }) => field)
    const relationshipAliases = definitions
      .filter(({ relation }) => relation)
      .map(({ relation }) => relation)
    const selectedFields = Array.from(
      new Set([...directFields, ...relationshipAliases])
    )
    const criteria =
      recordId === undefined || recordId === null
        ? null
        : { [resource.primaryKey]: recordId }

    const code = `
      const identity = ${JSON.stringify(resource.identity)};
      const criteria = ${JSON.stringify(criteria)};
      const submittedValues = ${JSON.stringify(values || {})};
      const selectedFields = ${JSON.stringify(selectedFields)};
      const definitions = ${JSON.stringify(definitions)};
      const model = sails.models[identity];
      if (!model) throw new Error('Configured Bridge model is unavailable.');

      let storedValues = {};
      if (criteria) {
        const query = model.findOne(criteria);
        const record = selectedFields.length > 0
          ? await query.select(selectedFields)
          : await query;
        if (!record) throw new Error('The Bridge record no longer exists.');
        storedValues = record;
      }

      const effectiveValues = { ...storedValues, ...submittedValues };
      const resolved = {};

      for (const definition of definitions) {
        if (!definition.relation) {
          resolved[definition.key] = effectiveValues[definition.field];
          continue;
        }

        let relatedId = effectiveValues[definition.relation];
        if (
          relatedId &&
          typeof relatedId === 'object' &&
          Object.prototype.hasOwnProperty.call(relatedId, definition.primaryKey)
        ) {
          relatedId = relatedId[definition.primaryKey];
        }
        if (relatedId === undefined || relatedId === null || relatedId === '') {
          resolved[definition.key] = null;
          continue;
        }

        const relatedModel = sails.models[definition.identity];
        if (!relatedModel) {
          throw new Error('Configured Bridge relationship model is unavailable.');
        }
        const related = await relatedModel
          .findOne({ [definition.primaryKey]: relatedId })
          .select([definition.primaryKey, definition.field]);
        resolved[definition.key] = related
          ? related[definition.field]
          : null;
      }

      return { resolved };
    `
    const wrappedCode = await sails.helpers.bridge.buildSailsWrapper(code)
    const result = await sails.helpers.bridge.executeInContainer(
      containerName,
      wrappedCode
    )
    if (!result.success) {
      throw uploadPathError(
        result.error || 'Bridge could not resolve the upload path.'
      )
    }

    let data
    try {
      data = JSON.parse(result.output)
    } catch (cause) {
      const error = uploadPathError(
        'Bridge could not read the resolved upload path.'
      )
      error.cause = cause
      throw error
    }

    const resolved = data.resolved || {}
    const directory = renderTemplate(directoryTemplate, definitions, resolved)
    const filename = renderTemplate(filenameTemplate, definitions, resolved)
    if (directory.length + filename.length > 900) {
      throw uploadPathError('The resolved Bridge upload path is too long.')
    }

    return { directory, filename }
  }
}

function readReferences(template) {
  const references = []
  for (const match of String(template || '').matchAll(TOKEN_PATTERN)) {
    references.push({
      key: match[0],
      root: match[1],
      field: match[2] || match[1],
      relation: match[2] ? match[1] : null,
      slug: Boolean(match[3])
    })
  }
  return references
}

function uniqueReferences(references) {
  return Array.from(
    new Map(references.map((reference) => [reference.key, reference])).values()
  )
}

function describeReference({ reference, resource, resources }) {
  if (!reference.relation) {
    const attribute = resource.attributes?.[reference.field]
    const association = resource.associations?.find(
      (candidate) => candidate.alias === reference.field
    )
    assertPathAttribute(attribute, association, reference.key)
    return reference
  }

  const relationship = resource.relationships?.[reference.relation]
  const relatedResource = relationship
    ? resources?.[relationship.resource]
    : null
  const attribute = relatedResource?.attributes?.[reference.field]
  const association = relatedResource?.associations?.find(
    (candidate) => candidate.alias === reference.field
  )
  if (!relationship || !relatedResource) {
    throw uploadPathError(
      `Bridge upload path reference "${reference.key}" uses an unavailable relationship.`
    )
  }
  assertPathAttribute(attribute, association, reference.key)

  return {
    ...reference,
    identity: relatedResource.identity,
    primaryKey: relatedResource.primaryKey
  }
}

function assertPathAttribute(attribute, association, reference) {
  if (
    !attribute ||
    association ||
    attribute.sensitive === true ||
    attribute.encrypt === true ||
    attribute.protect === true ||
    ['json', 'ref'].includes(attribute.type)
  ) {
    throw uploadPathError(
      `Bridge upload path reference "${reference}" is not a safe scalar field.`
    )
  }
}

function renderTemplate(template, definitions, values) {
  if (!template) return ''
  let output = template
  for (const definition of definitions) {
    if (!output.includes(definition.key)) continue
    const value = values[definition.key]
    if (value === undefined || value === null || String(value).trim() === '') {
      throw uploadPathError(
        `Complete ${humanize(
          definition.relation || definition.field
        )} before uploading this file.`
      )
    }
    const segment = definition.slug ? slugify(value) : safeObjectSegment(value)
    if (!segment) {
      throw uploadPathError(
        `${humanize(
          definition.relation || definition.field
        )} cannot be used in an upload path.`
      )
    }
    output = output.split(definition.key).join(segment)
  }
  return output
}

function slugify(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180)
}

function safeObjectSegment(value) {
  return String(value)
    .trim()
    .normalize('NFKC')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180)
}

function humanize(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (character) => character.toUpperCase())
}

function uploadPathError(message) {
  const error = new Error(message)
  error.code = 'BRIDGE_UPLOAD_PATH_INVALID'
  return error
}
