module.exports = {
  friendlyName: 'Destroy app',

  description:
    'Stop container and delete an app. Cannot delete the last or default app.',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true
    },
    environmentSlug: {
      type: 'string',
      required: true
    },
    appSlug: {
      type: 'string',
      required: true
    }
  },

  exits: {
    success: { statusCode: 200 },
    notFound: { statusCode: 404 },
    forbidden: { statusCode: 403 },
    badRequest: { responseType: 'badRequest' }
  },

  fn: async function ({ projectSlug, environmentSlug, appSlug }) {
    const user = await User.findOne({ id: this.req.session.userId })

    const project = await Project.findOne({ slug: projectSlug }).populate(
      'team'
    )
    if (!project || project.team.id !== user.team) throw 'notFound'

    // Only owner/admin can delete apps
    if (user.teamRole !== 'owner' && user.teamRole !== 'admin')
      throw 'forbidden'

    const environment = await Environment.findOne({
      project: project.id,
      slug: environmentSlug
    })
    if (!environment) throw 'notFound'

    const app = await App.findOne({
      environment: environment.id,
      slug: appSlug
    })
    if (!app) throw 'notFound'

    // Cannot delete the last app in an environment
    const appCount = await App.count({ environment: environment.id })
    if (appCount <= 1) {
      throw {
        badRequest: {
          problems: [{ app: 'Cannot delete the only app in an environment.' }]
        }
      }
    }

    // Cannot delete the default app (must reassign first)
    if (app.isDefault) {
      throw {
        badRequest: {
          problems: [
            {
              app: 'Cannot delete the default app. Assign another app as default first.'
            }
          ]
        }
      }
    }

    // Stop container if running
    if (app.containerName) {
      try {
        await sails.helpers.docker.stopContainer.with({
          containerName: app.containerName
        })
      } catch (err) {
        sails.log.warn(
          `Failed to stop app container ${app.containerName}: ${err.message}`
        )
      }
    }

    // Delete deployments for this app and the app itself
    await Deployment.update({ app: app.id }).set({ app: null })
    await App.destroyOne({ id: app.id })

    // Update Caddy routes
    try {
      await sails.helpers.caddy.updateRoute(environment.id)
    } catch (err) {
      sails.log.warn(`Caddy route update failed: ${err.message}`)
    }

    return { message: 'App deleted successfully' }
  }
}
