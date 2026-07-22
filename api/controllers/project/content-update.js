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
      required: true,
      regex: /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/
    },
    file: {
      type: 'string',
      required: true,
      regex: /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/
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
      description:
        'Raw file content (if provided, frontmatter and body are ignored)'
    },
    deploy: {
      type: 'boolean',
      defaultsTo: false,
      description: 'Whether to trigger a deploy after saving'
    },
    appSlug: {
      type: 'string',
      description: 'App whose source repository owns this content file'
    },
    sourceSha: {
      type: 'string',
      description: 'Git blob SHA loaded by the editor'
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

  fn: async function ({
    slug,
    envSlug,
    collection,
    file,
    frontmatter,
    body,
    raw,
    deploy,
    appSlug,
    sourceSha
  }) {
    const user = await User.findOne({ id: this.req.session.userId }).populate(
      'team'
    )
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
    const resolved = await sails.helpers.deploy.resolveTargetApp
      .with({
        environment,
        appSlug
      })
      .intercept('appNotFound', () => ({
        badRequest: {
          problems: [{ appSlug: 'Choose an app that still exists.' }]
        }
      }))
    const targetApp = resolved.app

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

    if (deploy) {
      const sourceReadiness =
        await sails.helpers.deploy.getSourceReadiness.with({
          project,
          environment,
          app: targetApp
        })

      if (!sourceReadiness.available) {
        throw {
          badRequest: {
            problems: [{ deploy: sourceReadiness.message }]
          }
        }
      }
    }

    const relativeFilePath = path.posix.join(
      String(contentDir).replace(/\\/g, '/'),
      collection,
      `${file}.${fileType === 'json' ? 'json' : 'md'}`
    )
    const commitMessage = `chore(content): update ${collection}/${file}`
    const persistence = await sails.helpers.git.commitContentFile
      .with({
        environment,
        app: targetApp,
        user,
        filePath: relativeFilePath,
        content,
        operation: 'update',
        expectedSha: sourceSha,
        message: commitMessage
      })
      .intercept('conflict', (error) => ({
        badRequest: {
          problems: [{ content: (error.raw || error).message }]
        }
      }))
      .intercept('writeUnavailable', (error) => ({
        badRequest: {
          problems: [{ content: (error.raw || error).message }]
        }
      }))

    // Keep the local build context in sync only after the source-of-truth
    // write succeeds. Repository deployments will refresh this exact commit.
    fs.writeFileSync(filePath, content, 'utf8')

    sails.log.info(`[content] Updated ${collection}/${file} in ${slug}`)

    // Trigger deploy if requested
    if (deploy) {
      const queued = await sails.helpers.deploy.triggerDeployment
        .with({
          project,
          environment,
          user,
          app: targetApp,
          gitCommit: persistence.commitSha,
          gitBranch: persistence.branch,
          gitMessage: commitMessage,
          triggerType: 'content',
          ipAddress: this.req.ip
        })
        .intercept('sourceUnavailable', (error) => ({
          badRequest: {
            problems: [{ deploy: (error.raw || error).message }]
          }
        }))
      const deployment = queued.deployment

      sails.log.info(
        `[content] Deployment ${deployment.id} triggered for content change`
      )

      // Redirect to deployment page
      return `/projects/${slug}/deployments/${deployment.id}`
    }

    // Stay on the same page (Inertia will reload props)
    const envPath = envSlug !== 'production' ? `/environments/${envSlug}` : ''
    return `/projects/${slug}${envPath}/content/${collection}/${file}?appSlug=${encodeURIComponent(
      targetApp.slug
    )}`
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
