const fs = require('fs')
const path = require('path')

module.exports = {
  friendlyName: 'Content delete',

  description: 'Delete a content file from a collection.',

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

  fn: async function ({ slug, envSlug, collection, file, appSlug, sourceSha }) {
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

    // Try .md first, then .json
    let filePath = path.join(appPath, contentDir, collection, `${file}.md`)

    if (!fs.existsSync(filePath)) {
      filePath = path.join(appPath, contentDir, collection, `${file}.json`)
    }

    if (!fs.existsSync(filePath)) {
      throw { badRequest: { error: 'Content file not found' } }
    }

    const extension = path.extname(filePath).slice(1)
    const relativeFilePath = path.posix.join(
      String(contentDir).replace(/\\/g, '/'),
      collection,
      `${file}.${extension}`
    )
    await sails.helpers.git.commitContentFile
      .with({
        environment,
        app: resolved.app,
        user,
        filePath: relativeFilePath,
        operation: 'delete',
        expectedSha: sourceSha,
        message: `chore(content): delete ${collection}/${file}`
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

    fs.unlinkSync(filePath)

    sails.log.info(`[content] Deleted ${collection}/${file} in ${slug}`)

    // Redirect to content manager
    const envPath = envSlug !== 'production' ? `/environments/${envSlug}` : ''
    return `/projects/${slug}${envPath}/content`
  }
}
