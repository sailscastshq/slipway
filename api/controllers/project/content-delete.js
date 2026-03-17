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
      required: true
    },
    file: {
      type: 'string',
      required: true
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

  fn: async function ({ slug, envSlug, collection, file }) {
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

    // Try .md first, then .json
    let filePath = path.join(appPath, contentDir, collection, `${file}.md`)

    if (!fs.existsSync(filePath)) {
      filePath = path.join(appPath, contentDir, collection, `${file}.json`)
    }

    if (!fs.existsSync(filePath)) {
      throw { badRequest: { error: 'Content file not found' } }
    }

    // Delete the file
    fs.unlinkSync(filePath)

    sails.log.info(`[content] Deleted ${collection}/${file} in ${slug}`)

    // Redirect to content manager
    const envPath = envSlug !== 'production' ? `/environments/${envSlug}` : ''
    return `/projects/${slug}${envPath}/content`
  }
}
