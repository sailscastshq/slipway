module.exports = {
  friendlyName: 'Destroy app',

  description: 'Run shared app cleanup. Cannot delete the last or default app.',

  inputs: {
    projectSlug: { type: 'string', required: true },
    environmentSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true },
    purgeData: { type: 'boolean', defaultsTo: false }
  },

  exits: {
    success: { statusCode: 200 },
    notFound: { statusCode: 404 },
    forbidden: { statusCode: 403 },
    badRequest: { responseType: 'badRequest' },
    cleanupFailed: {
      statusCode: 409,
      description: 'Cleanup paused and can be resumed'
    }
  },

  fn: async function ({ projectSlug, environmentSlug, appSlug, purgeData }) {
    const user = await User.findOne({ id: this.req.session.userId })
    const project = await Project.findOne({ slug: projectSlug }).populate(
      'team'
    )
    if (!project || Number(project.team.id) !== Number(user.team)) {
      throw 'notFound'
    }
    if (user.teamRole !== 'owner' && user.teamRole !== 'admin') {
      throw 'forbidden'
    }

    const environment = await Environment.findOne({
      project: project.id,
      slug: environmentSlug
    })
    if (!environment) throw 'notFound'

    const requestKey = `app:${projectSlug}/${environmentSlug}/${appSlug}`
    const app = await App.findOne({
      environment: environment.id,
      slug: appSlug
    })
    const targetKey = app ? `app:${app.id}` : undefined
    const existingOperation = await sails.helpers.cleanup.findOperation.with({
      targetKey,
      requestKey
    })
    if (!app && !existingOperation) throw 'notFound'

    if (app) {
      const appCount = await App.count({ environment: environment.id })
      if (appCount <= 1) {
        throw {
          badRequest: {
            problems: [{ app: 'Cannot delete the only app in an environment.' }]
          }
        }
      }
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
    }

    try {
      const cleanup = await sails.helpers.cleanup.run.with({
        targetKey: targetKey || existingOperation.targetKey,
        requestKey,
        scopeType: 'app',
        resourceId: app?.id || existingOperation.resourceId,
        retentionPolicy: purgeData ? 'purge' : 'retain',
        userId: user.id,
        teamId: project.team.id,
        ipAddress: this.req.ip
      })

      return {
        message: 'App deleted successfully',
        cleanup
      }
    } catch (error) {
      throw {
        cleanupFailed: {
          message: error.message,
          cleanup: error.cleanup || null
        }
      }
    }
  }
}
