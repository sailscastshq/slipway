const fs = require('fs')
const path = require('path')

module.exports = {
  friendlyName: 'Delete content',

  description: 'Delete a content file from a collection.',

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

    if (!fs.existsSync(filePath)) {
      filePath = path.join(appPath, contentDir, collection, `${file}.json`)
    }

    if (!fs.existsSync(filePath)) {
      throw 'notFound'
    }

    // Delete the file
    fs.unlinkSync(filePath)

    sails.log.info(`[content] Deleted ${collection}/${file} in ${project.slug}`)

    return {
      success: true,
      collection,
      file,
      deletedAt: new Date().toISOString()
    }
  }
}
