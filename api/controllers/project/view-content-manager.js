const fs = require('fs')
const path = require('path')

module.exports = {
  friendlyName: 'View content manager',

  description: 'Display the content manager page for a project.',

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

  fn: async function ({ slug, envSlug }) {
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
    const hasContentFeature = !!(
      environment.features && environment.features['sails-content']
    )
    const contentFeature = hasContentFeature
      ? environment.features['sails-content']
      : null
    const apps = await App.find({ environment: environment.id }).sort([
      'isDefault DESC',
      'name ASC',
      'id ASC'
    ])

    // Load collections if feature is available
    let collections = []
    let collectionsError = null

    if (hasContentFeature) {
      try {
        const contentDir = contentFeature.contentDir || 'content'
        const appPath = `${sails.config.custom.slipwayAppsDir}/${project.slug}`
        const contentPath = path.join(appPath, contentDir)

        if (fs.existsSync(contentPath)) {
          const entries = fs.readdirSync(contentPath, { withFileTypes: true })

          for (const entry of entries) {
            if (entry.isDirectory() && !entry.name.startsWith('.')) {
              const collectionPath = path.join(contentPath, entry.name)
              const files = fs
                .readdirSync(collectionPath)
                .filter((f) => f.endsWith('.md') || f.endsWith('.json'))

              collections.push({
                name: entry.name,
                slug: entry.name,
                count: files.length,
                files: files.map((f) => ({
                  name: f,
                  slug: f.replace(/\.(md|json)$/, '')
                }))
              })
            }
          }
        }
      } catch (err) {
        collectionsError = err.message
      }
    }

    return {
      page: 'projects/content-manager',
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
        hasContentFeature,
        contentFeature,
        collections,
        collectionsError,
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
