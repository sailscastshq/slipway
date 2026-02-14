const fs = require('fs')
const path = require('path')

module.exports = {
  friendlyName: 'Content update',

  description: 'Update a content file.',

  inputs: {
    slug: {
      type: 'string',
      required: true
    },
    envSlug: {
      type: 'string',
      defaultsTo: 'production'
    },
    collection: {
      type: 'string',
      required: true
    },
    file: {
      type: 'string',
      required: true
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
      responseType: 'redirect'
    },
    notFound: {
      responseType: 'redirect'
    },
    badRequest: {
      responseType: 'badRequest'
    }
  },

  fn: async function ({ slug, envSlug, collection, file, frontmatter, body, raw, deploy }) {
    const user = await User.findOne({ id: this.req.session.userId }).populate('team')
    if (!user) {
      throw { notFound: '/login' }
    }

    const project = await Project.findOne({ slug, team: user.team.id })
    if (!project) {
      throw { notFound: '/' }
    }

    const environment = await Environment.findOne({
      project: project.id,
      slug: envSlug
    })
    if (!environment) {
      throw { notFound: `/projects/${slug}` }
    }

    if (!environment.features || !environment.features['sails-content']) {
      throw { badRequest: { error: 'sails-content not detected' } }
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

    sails.log.info(`[content] Updated ${collection}/${file} in ${slug}`)

    // Trigger deploy if requested
    if (deploy) {
      const deployment = await Deployment.create({
        status: 'pending',
        gitMessage: `Content update: ${collection}/${file}`,
        triggeredBy: user.id,
        triggerType: 'manual',
        environment: environment.id,
        startedAt: Date.now()
      }).fetch()

      sails.log.info(`[content] Deployment ${deployment.id} triggered for content change`)

      // Kick off the async deployment pipeline
      process.nextTick(async () => {
        try {
          await sails.helpers.deploy.execute(deployment.id)
        } catch (err) {
          sails.log.error(`Content deploy failed: ${err.message}`)
        }
      })

      // Redirect to deployment page
      return `/projects/${slug}/deployments/${deployment.id}`
    }

    // Stay on the same page (Inertia will reload props)
    const envPath = envSlug !== 'production' ? `/environments/${envSlug}` : ''
    return `/projects/${slug}${envPath}/content/${collection}/${file}`
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
