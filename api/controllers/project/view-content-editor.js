const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

module.exports = {
  friendlyName: 'View content editor',

  description:
    'Display the content editor page for editing a specific content file.',

  inputs: {
    slug: {
      type: 'string',
      required: true,
      description: 'Project slug'
    },
    envSlug: {
      type: 'string',
      defaultsTo: 'production',
      description: 'Environment slug'
    },
    collection: {
      type: 'string',
      required: true,
      regex: /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/,
      description: 'Collection name'
    },
    file: {
      type: 'string',
      required: true,
      regex: /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/,
      description: 'File slug'
    },
    appSlug: {
      type: 'string',
      description: 'App whose source repository owns this content file'
    }
  },

  exits: {
    success: {
      responseType: 'inertia'
    },
    notFound: {
      responseType: 'redirect'
    }
  },

  fn: async function ({ slug, envSlug, collection, file, appSlug }) {
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

    // Check if sails-content is available
    if (!environment.features || !environment.features['sails-content']) {
      throw { notFound: `/projects/${slug}/environments/${envSlug}` }
    }

    const contentFeature = environment.features['sails-content']
    const contentDir = contentFeature.contentDir || 'content'
    const appPath = `${sails.config.custom.slipwayAppsDir}/${project.slug}`
    const apps = await App.find({ environment: environment.id }).sort([
      'isDefault DESC',
      'name ASC',
      'id ASC'
    ])
    const selectedApp = appSlug
      ? apps.find((app) => app.slug === appSlug)
      : apps.length === 1
      ? apps[0]
      : null

    // Load the content file
    let content = null
    let contentError = null

    try {
      // Try .md first, then .json
      let filePath = path.join(appPath, contentDir, collection, `${file}.md`)
      let fileType = 'markdown'

      if (!fs.existsSync(filePath)) {
        filePath = path.join(appPath, contentDir, collection, `${file}.json`)
        fileType = 'json'
      }

      if (!fs.existsSync(filePath)) {
        throw new Error('Content file not found')
      }

      let rawContent = fs.readFileSync(filePath, 'utf8')
      const stats = fs.statSync(filePath)
      let sourceSha = gitBlobSha(rawContent)
      let sourceMode = 'local'
      let repository = null
      if (selectedApp) {
        const relativeFilePath = path.posix.join(
          String(contentDir).replace(/\\/g, '/'),
          collection,
          `${file}.${fileType === 'json' ? 'json' : 'md'}`
        )
        const remote = await sails.helpers.git.readContentFile
          .with({
            environment,
            app: selectedApp,
            filePath: relativeFilePath
          })
          .intercept(
            'notFound',
            (error) => new Error((error.raw || error).message)
          )
          .intercept(
            'unavailable',
            (error) => new Error((error.raw || error).message)
          )
        if (remote.mode === 'repository') {
          rawContent = remote.content
          sourceSha = remote.sha
          sourceMode = 'repository'
          repository = remote.repository
        }
      }

      // Parse frontmatter for markdown files
      let frontmatter = {}
      let body = rawContent

      if (fileType === 'markdown') {
        const parsed = parseFrontmatter(rawContent)
        frontmatter = parsed.frontmatter
        body = parsed.body
      } else {
        // For JSON files, the whole content is structured data
        try {
          frontmatter = JSON.parse(rawContent)
          body = ''
        } catch (e) {
          // If JSON parsing fails, treat as raw content
        }
      }

      content = {
        fileType,
        frontmatter,
        body,
        raw: rawContent,
        sourceSha,
        sourceMode,
        repository,
        updatedAt: stats.mtime.toISOString()
      }
    } catch (err) {
      contentError = err.message
    }

    return {
      page: 'projects/content-editor',
      props: {
        project: {
          id: project.id,
          name: project.name,
          slug: project.slug
        },
        environment: {
          id: environment.id,
          name: environment.name,
          slug: environment.slug,
          features: environment.features
        },
        collection,
        file,
        contentFeature,
        content,
        contentError,
        selectedAppSlug: selectedApp?.slug || '',
        apps: apps.map((app) => ({
          id: app.id,
          name: app.name,
          slug: app.slug,
          isDefault: app.isDefault
        }))
      }
    }
  }
}

function gitBlobSha(content) {
  const value = Buffer.from(content, 'utf8')
  return crypto
    .createHash('sha1')
    .update(`blob ${value.length}\0`)
    .update(value)
    .digest('hex')
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
      if (
        (value.startsWith("'") && value.endsWith("'")) ||
        (value.startsWith('"') && value.endsWith('"'))
      ) {
        value = value.slice(1, -1)
      }

      frontmatter[key] = value
    }
  }

  return { frontmatter, body }
}
