const fs = require('fs')
const path = require('path')

module.exports = {
  friendlyName: 'Get models from static files',

  description:
    'Parse Waterline model definitions from source code files (no running app needed).',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true,
      description: 'Project slug'
    }
  },

  exits: {
    success: {
      description: 'Models parsed successfully',
      outputType: 'ref'
    },
    notFound: {
      description: 'Source directory not found'
    }
  },

  fn: async function ({ projectSlug }) {
    const appsDir = sails.config.custom.slipwayAppsDir || './data/apps'
    const appRoot = path.join(appsDir, projectSlug)
    const modelsDir = path.join(appRoot, 'api', 'models')

    sails.log.debug(`[dock] Apps directory: ${appsDir}`)
    sails.log.debug(`[dock] App root: ${appRoot}`)
    sails.log.debug(`[dock] Looking for models in: ${modelsDir}`)

    if (!fs.existsSync(modelsDir)) {
      sails.log.verbose(`[dock] Models directory not found: ${modelsDir}`)
      throw 'notFound'
    }

    // Parse config/models.js for default attributes and archive setting
    const { defaultAttrs, archiveModelIdentity } = parseConfigModels(appRoot)
    sails.log.verbose(
      `[dock] Default attributes from config/models.js:`,
      Object.keys(defaultAttrs)
    )
    sails.log.verbose(`[dock] Archive model identity:`, archiveModelIdentity)

    const models = {}
    const files = fs.readdirSync(modelsDir).filter((f) => f.endsWith('.js'))

    for (const file of files) {
      // Skip excluded models (sails-content)
      if (isExcludedModel(file)) {
        sails.log.verbose(`[dock] Skipping excluded model: ${file}`)
        continue
      }

      const filePath = path.join(modelsDir, file)
      try {
        const content = fs.readFileSync(filePath, 'utf8')
        const parsed = parseModelFile(content, file, defaultAttrs)
        if (parsed && Object.keys(parsed.attributes).length > 0) {
          models[parsed.identity] = parsed
          sails.log.verbose(
            `[dock] Parsed model: ${parsed.identity} with ${
              Object.keys(parsed.attributes).length
            } attributes`
          )
        }
      } catch (err) {
        sails.log.verbose(
          `[dock] Could not parse model ${file}: ${err.message}`
        )
      }
    }

    // Add Archive model if archiveModelIdentity is enabled
    if (archiveModelIdentity && archiveModelIdentity !== 'false') {
      const archiveIdentity =
        archiveModelIdentity === true ? 'archive' : archiveModelIdentity
      models[archiveIdentity] = getArchiveModel(archiveIdentity, defaultAttrs)
      sails.log.verbose(`[dock] Added archive model: ${archiveIdentity}`)
    }

    // Resolve FK types: inherit the referenced model's PK type
    for (const model of Object.values(models)) {
      for (const attr of Object.values(model.attributes)) {
        if (!attr.foreignKey || !attr.references) continue

        const referencedModel = models[attr.references]
        if (!referencedModel) continue

        const pkName = referencedModel.primaryKey || 'id'
        const pkAttr = referencedModel.attributes[pkName]
        if (pkAttr && pkAttr.type) {
          attr.type = pkAttr.type
        }
      }
    }

    sails.log.verbose(
      `[dock] Total models found: ${Object.keys(models).length}`
    )
    return { models }
  }
}

/**
 * Check if a model file should be excluded from schema diff.
 * This includes sails-content models.
 */
function isExcludedModel(filename) {
  const baseName = filename.toLowerCase().replace('.js', '')

  // sails-content models
  const contentModels = ['contententry', 'content']

  return contentModels.includes(baseName)
}

/**
 * Parse config/models.js to get default attributes and archive setting
 * These get merged into every model (like id, createdAt, updatedAt)
 */
function parseConfigModels(appRoot) {
  const configPath = path.join(appRoot, 'config', 'models.js')
  const defaultAttrs = {}
  let archiveModelIdentity = 'archive' // Sails default

  if (!fs.existsSync(configPath)) {
    // Return standard Sails defaults
    const defaults = getStandardDefaults()
    return { defaultAttrs: defaults, archiveModelIdentity }
  }

  try {
    const content = fs.readFileSync(configPath, 'utf8')

    // Strip comments first
    const cleanContent = stripComments(content)

    // Check if using archiveModelIdentity (soft deletes)
    // Can be: 'archive', 'customname', false, or not set (defaults to 'archive')
    const archiveStringMatch = cleanContent.match(
      /archiveModelIdentity:\s*['"]([^'"]+)['"]/
    )
    const archiveFalseMatch = cleanContent.match(
      /archiveModelIdentity:\s*false/
    )

    if (archiveFalseMatch) {
      archiveModelIdentity = false
    } else if (archiveStringMatch) {
      archiveModelIdentity = archiveStringMatch[1]
    }
    // else: keep default 'archive'

    // Parse attributes from config
    const attributesBlock = extractAttributesBlock(cleanContent)
    if (attributesBlock) {
      const attrs = parseAttributes(attributesBlock)
      Object.assign(defaultAttrs, attrs)
    }

    // If no id attribute found, add the standard one
    if (!defaultAttrs.id) {
      defaultAttrs.id = {
        type: 'number',
        autoIncrement: true,
        columnName: 'id'
      }
    }

    // Check for createdAt/updatedAt settings
    const createdAtMatch = cleanContent.match(
      /createdAt:\s*(true|false|['"][^'"]+['"])/
    )
    const updatedAtMatch = cleanContent.match(
      /updatedAt:\s*(true|false|['"][^'"]+['"])/
    )

    // If timestamps are enabled (default in Sails), add them
    if (!createdAtMatch || createdAtMatch[1] !== 'false') {
      if (!defaultAttrs.createdAt) {
        defaultAttrs.createdAt = {
          type: 'number',
          autoCreatedAt: true,
          columnName: 'createdAt'
        }
      }
    }

    if (!updatedAtMatch || updatedAtMatch[1] !== 'false') {
      if (!defaultAttrs.updatedAt) {
        defaultAttrs.updatedAt = {
          type: 'number',
          autoUpdatedAt: true,
          columnName: 'updatedAt'
        }
      }
    }

    return { defaultAttrs, archiveModelIdentity }
  } catch (err) {
    sails.log.verbose(`[dock] Could not parse config/models.js: ${err.message}`)
    const defaults = getStandardDefaults()
    return { defaultAttrs: defaults, archiveModelIdentity }
  }
}

/**
 * Get standard Sails model defaults when config/models.js can't be parsed
 */
function getStandardDefaults() {
  return {
    id: {
      type: 'number',
      autoIncrement: true,
      columnName: 'id'
    },
    createdAt: {
      type: 'number',
      autoCreatedAt: true,
      columnName: 'createdAt'
    },
    updatedAt: {
      type: 'number',
      autoUpdatedAt: true,
      columnName: 'updatedAt'
    }
  }
}

/**
 * Get the Archive model definition for soft-deletes.
 * This matches the implicit Archive model created by Sails/Waterline.
 */
function getArchiveModel(identity, defaultAttrs) {
  return {
    identity,
    tableName: identity,
    primaryKey: 'id',
    attributes: {
      id: defaultAttrs.id || {
        type: 'number',
        autoIncrement: true,
        columnName: 'id'
      },
      createdAt: defaultAttrs.createdAt || {
        type: 'number',
        autoCreatedAt: true,
        columnName: 'createdAt'
      },
      fromModel: {
        type: 'string',
        required: true,
        columnName: 'fromModel'
      },
      originalRecord: {
        type: 'json',
        required: true,
        columnName: 'originalRecord'
      },
      originalRecordId: {
        type: 'json',
        required: true,
        columnName: 'originalRecordId'
      }
    }
  }
}

/**
 * Parse a Waterline model file to extract attributes
 * Uses brace-counting for more reliable parsing
 */
function parseModelFile(content, filename, defaultAttrs = {}) {
  const identity = filename.replace('.js', '').toLowerCase()

  // Strip comments first
  const cleanContent = stripComments(content)

  // Extract tableName if specified
  const tableNameMatch = cleanContent.match(/tableName:\s*['"]([^'"]+)['"]/)
  const tableName = tableNameMatch ? tableNameMatch[1] : identity

  // Extract primaryKey if specified
  const primaryKeyMatch = cleanContent.match(/primaryKey:\s*['"]([^'"]+)['"]/)
  const primaryKey = primaryKeyMatch ? primaryKeyMatch[1] : 'id'

  // Find the attributes object using brace counting
  const attributesBlock = extractAttributesBlock(cleanContent)
  if (!attributesBlock) {
    return null
  }

  // Start with default attributes, then override with model-specific ones
  const attributes = {}

  // Add default attributes (id, createdAt, updatedAt)
  for (const [name, attr] of Object.entries(defaultAttrs)) {
    attributes[name] = { ...attr }
  }

  // Parse model-specific attributes and merge
  const modelAttrs = parseAttributes(attributesBlock)
  for (const [name, attr] of Object.entries(modelAttrs)) {
    attributes[name] = attr
  }

  // Explicitly disabled attributes like `updatedAt: false` should win over defaults.
  for (const name of findDisabledAttributes(attributesBlock)) {
    delete attributes[name]
  }

  return {
    identity,
    tableName,
    primaryKey,
    attributes
  }
}

/**
 * Strip single-line comments from code
 * Preserves strings (doesn't strip // inside strings)
 */
function stripComments(code) {
  let result = ''
  let i = 0

  while (i < code.length) {
    // Check for string start
    if (code[i] === '"' || code[i] === "'") {
      const quote = code[i]
      result += code[i]
      i++
      // Copy entire string including escapes
      while (i < code.length && code[i] !== quote) {
        if (code[i] === '\\' && i + 1 < code.length) {
          result += code[i] + code[i + 1]
          i += 2
        } else {
          result += code[i]
          i++
        }
      }
      if (i < code.length) {
        result += code[i] // closing quote
        i++
      }
    }
    // Check for single-line comment
    else if (code[i] === '/' && code[i + 1] === '/') {
      // Skip until end of line
      while (i < code.length && code[i] !== '\n') {
        i++
      }
    }
    // Check for multi-line comment
    else if (code[i] === '/' && code[i + 1] === '*') {
      i += 2
      while (i < code.length - 1 && !(code[i] === '*' && code[i + 1] === '/')) {
        i++
      }
      i += 2 // skip */
    } else {
      result += code[i]
      i++
    }
  }

  return result
}

/**
 * Extract the attributes block using brace counting
 * More reliable than regex for nested structures
 * Expects content to already have comments stripped
 */
function extractAttributesBlock(content) {
  // Find the start of attributes
  const attrMatch = content.match(/attributes:\s*\{/)
  if (!attrMatch) {
    return null
  }

  const startIndex = attrMatch.index + attrMatch[0].length
  let braceCount = 1
  let endIndex = startIndex

  // Count braces to find the matching closing brace
  for (let i = startIndex; i < content.length && braceCount > 0; i++) {
    const char = content[i]
    if (char === '{') {
      braceCount++
    } else if (char === '}') {
      braceCount--
    }
    // Skip strings to avoid counting braces inside them
    if (char === "'" || char === '"') {
      const quote = char
      i++
      while (i < content.length && content[i] !== quote) {
        if (content[i] === '\\') i++ // Skip escaped chars
        i++
      }
    }
    endIndex = i
  }

  if (braceCount !== 0) {
    return null
  }

  return content.substring(startIndex, endIndex)
}

/**
 * Parse attributes from the attributes block
 */
function parseAttributes(block) {
  const attributes = {}

  // Match attribute definitions - improved regex
  // Handles: name: { ... } patterns including nested objects
  const attrRegex = /(\w+)\s*:\s*\{/g
  let match

  while ((match = attrRegex.exec(block)) !== null) {
    const name = match[1]
    const startIndex = match.index + match[0].length

    // Extract this attribute's content using brace counting
    let braceCount = 1
    let endIndex = startIndex

    for (let i = startIndex; i < block.length && braceCount > 0; i++) {
      const char = block[i]
      if (char === '{') {
        braceCount++
      } else if (char === '}') {
        braceCount--
      }
      // Skip strings
      if (char === "'" || char === '"') {
        const quote = char
        i++
        while (i < block.length && block[i] !== quote) {
          if (block[i] === '\\') i++
          i++
        }
      }
      endIndex = i
    }

    const attrBlock = block.substring(startIndex, endIndex)

    // Skip collection associations (virtual, no DB column)
    if (attrBlock.includes('collection:')) {
      continue
    }

    // Handle model associations (FK columns -- INTEGER in the DB)
    if (attrBlock.includes('model:')) {
      const modelMatch = attrBlock.match(/model:\s*['"]([^'"]+)['"]/)
      if (modelMatch) {
        const attr = extractCommonProperties(attrBlock, name)
        attr.type = 'number'
        attr.foreignKey = true
        attr.references = modelMatch[1]
        attributes[name] = attr
      }
      continue
    }

    const attr = parseAttribute(attrBlock, name)
    if (attr) {
      attributes[name] = attr
    }
  }

  return attributes
}

/**
 * Find top-level model attributes explicitly disabled with `attrName: false`.
 */
function findDisabledAttributes(block) {
  const disabled = new Set()

  for (const entry of splitTopLevelEntries(block)) {
    const match = entry.match(/^(\w+)\s*:\s*false\b/)
    if (match) {
      disabled.add(match[1])
    }
  }

  return disabled
}

/**
 * Split an attributes block into top-level entries while ignoring nested commas.
 */
function splitTopLevelEntries(block) {
  const entries = []
  let current = ''
  let curlyDepth = 0
  let squareDepth = 0
  let parenDepth = 0

  for (let i = 0; i < block.length; i++) {
    const char = block[i]

    if (char === "'" || char === '"') {
      current += char
      i++

      while (i < block.length) {
        current += block[i]
        if (block[i] === '\\' && i + 1 < block.length) {
          i++
          current += block[i]
          continue
        }
        if (block[i] === char) {
          break
        }
        i++
      }
      continue
    }

    if (char === '{') curlyDepth++
    else if (char === '}') curlyDepth--
    else if (char === '[') squareDepth++
    else if (char === ']') squareDepth--
    else if (char === '(') parenDepth++
    else if (char === ')') parenDepth--

    if (
      char === ',' &&
      curlyDepth === 0 &&
      squareDepth === 0 &&
      parenDepth === 0
    ) {
      const entry = current.trim()
      if (entry) {
        entries.push(entry)
      }
      current = ''
      continue
    }

    current += char
  }

  const entry = current.trim()
  if (entry) {
    entries.push(entry)
  }

  return entries
}

/**
 * Extract common properties shared by all attribute types (regular and FK).
 * Parses columnName, required, unique, index, allowNull, and other boolean flags.
 */
function extractCommonProperties(block, name) {
  const attr = { columnName: name }

  // Extract string properties
  const stringProps = ['type', 'columnType', 'columnName']
  for (const prop of stringProps) {
    const match = block.match(new RegExp(`${prop}:\\s*['"]([^'"]+)['"]`))
    if (match) {
      attr[prop] = match[1]
    }
  }

  // Extract boolean properties (all follow the same pattern)
  const boolProps = [
    'required',
    'unique',
    'index',
    'allowNull',
    'autoIncrement',
    'autoCreatedAt',
    'autoUpdatedAt'
  ]
  for (const prop of boolProps) {
    const match = block.match(new RegExp(`${prop}:\\s*(true|false)`))
    if (match) {
      attr[prop] = match[1] === 'true'
    }
  }

  // Extract defaultsTo
  const defaultsToMatch = block.match(/defaultsTo:\s*([^,\n}]+)/)
  if (defaultsToMatch) {
    const val = defaultsToMatch[1].trim()
    if (val === 'true') attr.defaultsTo = true
    else if (val === 'false') attr.defaultsTo = false
    else if (val.match(/^['"].*['"]$/)) attr.defaultsTo = val.slice(1, -1)
    else if (!isNaN(val)) attr.defaultsTo = Number(val)
  }

  // Extract isIn (enum values)
  const isInMatch = block.match(/isIn:\s*\[([^\]]+)\]/)
  if (isInMatch) {
    attr.isIn = isInMatch[1]
      .split(',')
      .map((v) => v.trim().replace(/['"]/g, ''))
  }

  return attr
}

/**
 * Parse a single attribute definition.
 * Returns null if no type information can be determined.
 */
function parseAttribute(block, name) {
  const attr = extractCommonProperties(block, name)

  // If no explicit type, try to infer from other properties
  if (!attr.type && !attr.columnType) {
    if (attr.autoCreatedAt || attr.autoUpdatedAt) {
      attr.type = 'number'
    } else if (attr.autoIncrement) {
      attr.type = 'number'
    } else {
      return null
    }
  }

  return attr
}

module.exports._private = {
  findDisabledAttributes,
  parseModelFile,
  splitTopLevelEntries
}
