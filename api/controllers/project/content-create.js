const fs = require('fs')
const path = require('path')

module.exports = {
  friendlyName: 'Content create',

  description: 'Create a new content file in a collection.',

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
    contentSlug: {
      type: 'string',
      required: true
    },
    title: {
      type: 'string'
    },
    appSlug: {
      type: 'string',
      description: 'App whose source repository owns this content file'
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
    contentSlug,
    title,
    appSlug
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
      .with({ environment, appSlug, requireExplicit: true })
      .intercept('appNotFound', () => ({
        badRequest: {
          problems: [{ appSlug: 'Choose an app that still exists.' }]
        }
      }))
      .intercept('appSelectionRequired', () => ({
        badRequest: {
          problems: [{ appSlug: 'Choose which app owns this content.' }]
        }
      }))

    // Sanitize slug
    const safeSlug = contentSlug
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')

    if (!safeSlug) {
      throw {
        badRequest: {
          problems: [{ contentSlug: 'Enter a valid content slug.' }]
        }
      }
    }

    const collectionPath = path.join(appPath, contentDir, collection)
    const filePath = path.join(collectionPath, `${safeSlug}.md`)

    // Check if file already exists
    if (fs.existsSync(filePath)) {
      throw {
        badRequest: { error: `Content file "${safeSlug}.md" already exists` }
      }
    }

    // Build frontmatter
    const frontmatter = {}
    if (title) frontmatter.title = title
    frontmatter.createdAt = new Date().toISOString()

    // Generate content
    let content = '---\n'
    for (const [key, value] of Object.entries(frontmatter)) {
      if (
        typeof value === 'string' &&
        (value.includes(':') || value.includes('#'))
      ) {
        content += `${key}: '${value}'\n`
      } else {
        content += `${key}: ${value}\n`
      }
    }
    content += '---\n\n'
    content += `# ${title || safeSlug}\n\nStart writing your content here.\n`

    const relativeFilePath = path.posix.join(
      String(contentDir).replace(/\\/g, '/'),
      collection,
      `${safeSlug}.md`
    )
    await sails.helpers.git.commitContentFile
      .with({
        environment,
        app: resolved.app,
        user,
        filePath: relativeFilePath,
        content,
        operation: 'create',
        message: `chore(content): create ${collection}/${safeSlug}`
      })
      .intercept('conflict', (error) => ({
        badRequest: {
          problems: [{ contentSlug: (error.raw || error).message }]
        }
      }))
      .intercept('writeUnavailable', (error) => ({
        badRequest: {
          problems: [{ contentSlug: (error.raw || error).message }]
        }
      }))

    if (!fs.existsSync(collectionPath)) {
      fs.mkdirSync(collectionPath, { recursive: true })
    }
    fs.writeFileSync(filePath, content, 'utf8')

    sails.log.info(`[content] Created ${collection}/${safeSlug}.md in ${slug}`)

    // Redirect to editor
    const envPath = envSlug !== 'production' ? `/environments/${envSlug}` : ''
    return `/projects/${slug}${envPath}/content/${collection}/${safeSlug}?appSlug=${encodeURIComponent(
      resolved.app.slug
    )}`
  }
}
