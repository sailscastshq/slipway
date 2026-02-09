const fs = require('fs')
const path = require('path')

module.exports = {
  friendlyName: 'List collections',

  description: 'List all content collections for a project.',

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
    },
    featureNotAvailable: {
      statusCode: 400,
      description: 'sails-content not detected in this app'
    }
  },

  fn: async function ({ projectSlug, environmentSlug }) {
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
      throw {
        featureNotAvailable: {
          message: 'sails-content not detected in this application. Deploy with sails-content installed to enable the Content Manager.'
        }
      }
    }

    const contentFeature = environment.features['sails-content']
    const contentDir = contentFeature.contentDir || 'content'
    const appPath = `${sails.config.custom.slipwayAppsDir}/${project.slug}`
    const contentPath = path.join(appPath, contentDir)

    const collections = []

    if (fs.existsSync(contentPath)) {
      const entries = fs.readdirSync(contentPath, { withFileTypes: true })

      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          const collectionPath = path.join(contentPath, entry.name)
          const files = fs.readdirSync(collectionPath).filter(f => f.endsWith('.md') || f.endsWith('.json'))

          collections.push({
            name: entry.name,
            slug: entry.name,
            count: files.length,
            files: files.map(f => ({
              name: f,
              slug: f.replace(/\.(md|json)$/, '')
            }))
          })
        }
      }
    }

    return {
      collections,
      contentDir
    }
  }
}
