const fs = require('fs')
const path = require('path')

module.exports = {
  friendlyName: 'Create content',

  description: 'Create a new content file in a collection.',

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
      description: 'Collection name'
    },
    slug: {
      type: 'string',
      required: true,
      description: 'File slug (will become filename)'
    },
    title: {
      type: 'string',
      description: 'Content title (added to frontmatter)'
    },
    layout: {
      type: 'string',
      description: 'Layout template path'
    },
    body: {
      type: 'string',
      defaultsTo: '',
      description: 'Initial markdown body'
    }
  },

  exits: {
    success: {
      statusCode: 201
    },
    notFound: {
      statusCode: 404
    },
    forbidden: {
      statusCode: 403
    },
    conflict: {
      statusCode: 409,
      description: 'File already exists'
    }
  },

  fn: async function ({ projectSlug, environmentSlug, collection, slug, title, layout, body }) {
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

    // Sanitize slug
    const safeSlug = slug
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')

    const collectionPath = path.join(appPath, contentDir, collection)
    const filePath = path.join(collectionPath, `${safeSlug}.md`)

    // Check if file already exists
    if (fs.existsSync(filePath)) {
      throw {
        conflict: {
          message: `Content file "${safeSlug}.md" already exists in collection "${collection}"`
        }
      }
    }

    // Ensure collection directory exists
    if (!fs.existsSync(collectionPath)) {
      fs.mkdirSync(collectionPath, { recursive: true })
    }

    // Build frontmatter
    const frontmatter = {}
    if (title) frontmatter.title = title
    if (layout) frontmatter.layout = layout
    frontmatter.createdAt = new Date().toISOString()

    // Generate content
    let content = '---\n'
    for (const [key, value] of Object.entries(frontmatter)) {
      if (typeof value === 'string' && (value.includes(':') || value.includes('#'))) {
        content += `${key}: '${value}'\n`
      } else {
        content += `${key}: ${value}\n`
      }
    }
    content += '---\n\n'
    content += body || `# ${title || safeSlug}\n\nStart writing your content here.\n`

    // Write file
    fs.writeFileSync(filePath, content, 'utf8')

    sails.log.info(`[content] Created ${collection}/${safeSlug}.md in ${project.slug}`)

    return {
      success: true,
      collection,
      file: safeSlug,
      path: `${collection}/${safeSlug}.md`,
      frontmatter,
      createdAt: new Date().toISOString()
    }
  }
}
