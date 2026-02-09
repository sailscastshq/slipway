const fs = require('fs')
const path = require('path')

module.exports = {
  friendlyName: 'Get content',

  description: 'Get a content file (markdown or JSON) from a collection.',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true,
      description: 'Project slug'
    },
    environmentSlug: {
      type: 'string',
      defaultsTo: 'production',
      description: 'Environment slug'
    },
    collection: {
      type: 'string',
      required: true,
      description: 'Collection name (e.g., "blog", "docs")'
    },
    file: {
      type: 'string',
      required: true,
      description: 'File slug (without extension)'
    }
  },

  exits: {
    success: {
      statusCode: 200
    },
    notFound: {
      statusCode: 404
    },
    forbidden: {
      statusCode: 403
    }
  },

  fn: async function ({ projectSlug, environmentSlug, collection, file }) {
    const user = await User.findOne({ id: this.req.session.userId })
    const project = await Project.findOne({ slug: projectSlug }).populate('team')

    if (!project) {
      throw 'notFound'
    }

    if (project.team.id !== user.team) {
      throw 'forbidden'
    }

    const environment = await Environment.findOne({
      project: project.id,
      slug: environmentSlug
    })

    if (!environment) {
      throw 'notFound'
    }

    // Check if sails-content is detected
    if (!environment.features || !environment.features['sails-content']) {
      throw 'notFound'
    }

    const contentFeature = environment.features['sails-content']
    const contentDir = contentFeature.contentDir || 'content'
    const appPath = `${sails.config.custom.slipwayAppsDir}/${project.slug}`

    // Try .md first, then .json
    let filePath = path.join(appPath, contentDir, collection, `${file}.md`)
    let fileType = 'markdown'

    if (!fs.existsSync(filePath)) {
      filePath = path.join(appPath, contentDir, collection, `${file}.json`)
      fileType = 'json'
    }

    if (!fs.existsSync(filePath)) {
      throw 'notFound'
    }

    const content = fs.readFileSync(filePath, 'utf8')
    const stats = fs.statSync(filePath)

    // Parse frontmatter for markdown files
    let frontmatter = {}
    let body = content

    if (fileType === 'markdown') {
      const parsed = parseFrontmatter(content)
      frontmatter = parsed.frontmatter
      body = parsed.body
    } else {
      // For JSON files, the whole content is structured data
      try {
        frontmatter = JSON.parse(content)
        body = ''
      } catch (e) {
        // If JSON parsing fails, treat as raw content
      }
    }

    return {
      collection,
      file,
      fileType,
      frontmatter,
      body,
      raw: content,
      updatedAt: stats.mtime.toISOString()
    }
  }
}

/**
 * Parse YAML frontmatter from markdown content
 */
function parseFrontmatter(content) {
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/
  const match = content.match(frontmatterRegex)

  if (!match) {
    return { frontmatter: {}, body: content }
  }

  const frontmatterStr = match[1]
  const body = match[2]

  // Simple YAML parsing (key: value pairs)
  const frontmatter = {}
  const lines = frontmatterStr.split('\n')

  for (const line of lines) {
    const colonIndex = line.indexOf(':')
    if (colonIndex > 0) {
      const key = line.substring(0, colonIndex).trim()
      let value = line.substring(colonIndex + 1).trim()

      // Remove quotes
      if ((value.startsWith("'") && value.endsWith("'")) ||
          (value.startsWith('"') && value.endsWith('"'))) {
        value = value.slice(1, -1)
      }

      frontmatter[key] = value
    }
  }

  return { frontmatter, body }
}
