module.exports = {
  friendlyName: 'View Bridge access',

  description: 'Manage app-scoped Bridge invitations and access.',

  inputs: {
    slug: { type: 'string', required: true },
    envSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true }
  },

  exits: {
    success: { responseType: 'inertia' },
    notFound: { responseType: 'redirect' },
    forbidden: { responseType: 'redirect' }
  },

  fn: async function ({ slug, envSlug, appSlug }) {
    let resolved
    try {
      resolved = await sails.helpers.bridge.resolveManager.with({
        req: this.req,
        projectSlug: slug,
        environmentSlug: envSlug,
        appSlug
      })
    } catch (error) {
      if (error.code === 'forbidden') throw { forbidden: '/' }
      throw { notFound: '/' }
    }

    const { project, environment, app } = resolved
    const access = await BridgeAccess.find({ app: app.id })
      .sort(['status ASC', 'createdAt DESC'])
      .populate('invitedBy')
    const appUrl = await sails.helpers.bridge.getAppUrl.with({
      app,
      environment,
      project
    })

    return {
      page: 'projects/bridge-access',
      props: {
        project: pick(project, ['id', 'name', 'slug']),
        environment: pick(environment, [
          'id',
          'name',
          'slug',
          'features',
          'isProduction'
        ]),
        app: {
          ...pick(app, [
            'id',
            'name',
            'slug',
            'status',
            'routePath',
            'bridgeEnabled'
          ]),
          appUrl,
          bridgeUrl: appUrl ? `${appUrl}/bridge` : null
        },
        access: access.map((grant) => ({
          id: grant.id,
          email: grant.email,
          role: grant.role,
          status: grant.status,
          hostUserId: grant.hostUserId,
          hostUserName: grant.hostUserName,
          activatedAt: grant.activatedAt,
          lastUsedAt: grant.lastUsedAt,
          inviteExpiresAt: grant.inviteExpiresAt,
          createdAt: grant.createdAt,
          invitedBy: grant.invitedBy
            ? {
                id: grant.invitedBy.id,
                fullName: grant.invitedBy.fullName
              }
            : null
        })),
        hookDetected: Boolean(environment.features?.['sails-hook-slipway'])
      }
    }
  }
}

function pick(value, keys) {
  return Object.fromEntries(keys.map((key) => [key, value[key]]))
}
