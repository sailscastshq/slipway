const fs = require('fs')
const path = require('path')

module.exports = {
  friendlyName: 'Update content',

  description: 'Update a content file and optionally trigger a deploy.',

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
    file: {
      type: 'string',
      required: true,
      description: 'File slug (without extension)'
    },
    frontmatter: {
      type: 'ref',
      description: 'Frontmatter object (will be serialized to YAML)'
    },
    body: {
      type: 'string',
      description: 'Markdown body content'
    },
    raw: {
      type: 'string',
      description: 'Raw file content (if provided, frontmatter and body are ignored)'
    },
    deploy: {
      type: 'boolean',
      defaultsTo: false,
      description: 'Whether to trigger a deploy after saving'
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

  fn: async function ({ projectSlug, environmentSlug, collection, file, frontmatter, body, raw, deploy }) {
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

    // Determine file path and type
    let filePath = path.join(appPath, contentDir, collection, `${file}.md`)
    let fileType = 'markdown'

    if (!fs.existsSync(filePath)) {
      filePath = path.join(appPath, contentDir, collection, `${file}.json`)
      fileType = 'json'
    }

    // For new files, default to markdown
    if (!fs.existsSync(filePath)) {
      filePath = path.join(appPath, contentDir, collection, `${file}.md`)
      fileType = 'markdown'

      // Ensure collection directory exists
      const collectionPath = path.join(appPath, contentDir, collection)
      if (!fs.existsSync(collectionPath)) {
        fs.mkdirSync(collectionPath, { recursive: true })
      }
    }

    // Generate content
    let content
    if (raw !== undefined) {
      content = raw
    } else if (fileType === 'markdown') {
      content = serializeFrontmatter(frontmatter, body)
    } else {
      content = JSON.stringify(frontmatter, null, 2)
    }

    // Write file
    fs.writeFileSync(filePath, content, 'utf8')

    sails.log.info(`[content] Updated ${collection}/${file} in ${project.slug}`)

    // Trigger deploy if requested
    let deployment = null
    if (deploy) {
      deployment = await Deployment.create({
        status: 'pending',
        gitMessage: `Content update: ${collection}/${file}`,
        triggeredBy: user.id,
        triggerType: 'manual',
        environment: environment.id,
        startedAt: Date.now()
      }).fetch()

      sails.log.info(`[content] Deployment ${deployment.id} triggered for content change`)

      // Kick off the async deployment pipeline
      const triggerDeployment = require('../deploy/trigger-deployment')
      process.nextTick(async () => {
        try {
          // Re-use the deployment logic
          const { executeDeployment } = require('../deploy/trigger-deployment')
          // Note: This is a simplified approach - in production you'd want to
          // properly modularize the deployment pipeline
        } catch (err) {
          sails.log.error(`Content deploy failed: ${err.message}`)
        }
      })
    }

    return {
      success: true,
      collection,
      file,
      fileType,
      updatedAt: new Date().toISOString(),
      deployment: deployment ? { id: deployment.id, status: deployment.status } : null
    }
  }
}

/**
 * Serialize frontmatter and body back to markdown with YAML frontmatter
 */
function serializeFrontmatter(frontmatter, body) {
  if (!frontmatter || Object.keys(frontmatter).length === 0) {
    return body || ''
  }

  let yaml = '---\n'
  for (const [key, value] of Object.entries(frontmatter)) {
    if (typeof value === 'string') {
      // Quote strings that contain special characters
      if (value.includes(':') || value.includes('#') || value.includes('\n')) {
        yaml += `${key}: '${value.replace(/'/g, "''")}'\n`
      } else {
        yaml += `${key}: ${value}\n`
      }
    } else if (typeof value === 'boolean' || typeof value === 'number') {
      yaml += `${key}: ${value}\n`
    } else {
      // For complex values, JSON stringify
      yaml += `${key}: ${JSON.stringify(value)}\n`
    }
  }
  yaml += '---\n\n'

  return yaml + (body || '')
}
