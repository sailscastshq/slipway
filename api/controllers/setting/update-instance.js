module.exports = {
  friendlyName: 'Update instance settings',

  description: 'Update the instance configuration.',

  inputs: {
    instanceDomain: {
      type: 'string',
      description: 'The domain/URL of this Slipway instance'
    },
    instanceName: {
      type: 'string',
      description: 'The name of this Slipway instance'
    },
    acmeEmail: {
      type: 'string',
      description:
        "Email address for Let's Encrypt ACME certificate provisioning"
    }
  },

  exits: {
    success: {
      responseType: 'inertiaRedirect'
    },
    invalid: {
      responseType: 'badRequest'
    },
    precognitionSuccess: {
      responseType: 'precognitionSuccess'
    }
  },

  fn: async function ({ instanceDomain, instanceName, acmeEmail }) {
    const user = await User.forRequest(this.req)
    const problems = sails.helpers.setting.validate(
      {
        instanceDomain,
        instanceName,
        acmeEmail
      },
      [],
      this.req
    )
    if (problems.length) {
      throw { invalid: { problems } }
    }
    if (sails.inertia.isPrecognitive(this.req)) {
      throw 'precognitionSuccess'
    }

    const before = {}
    for (const key of ['instanceDomain', 'instanceName', 'acmeEmail'])
      before[key] = await sails.helpers.setting.get(key, '')
    const desired = {
      instanceDomain:
        instanceDomain === undefined
          ? before.instanceDomain
          : instanceDomain
              .trim()
              .replace(/^https?:\/\//, '')
              .replace(/\/+$/, ''),
      instanceName:
        instanceName === undefined ? before.instanceName : instanceName.trim(),
      acmeEmail: acmeEmail === undefined ? before.acmeEmail : acmeEmail.trim()
    }
    let route
    try {
      if (instanceDomain !== undefined || acmeEmail !== undefined) {
        if (desired.instanceDomain)
          route = await sails.helpers.caddy.updateDashboardRoute.with({
            domain: desired.instanceDomain,
            acmeEmail: desired.acmeEmail || '',
            deferCommit: true
          })
        else if (before.instanceDomain) {
          await sails.helpers.caddy.removeDashboardRoute()
          await sails.helpers.caddy.verifyRoute.with({
            expectedUpstreams: [],
            excludedDomains: [before.instanceDomain]
          })
        }
      }
      for (const [key, value] of Object.entries(desired))
        await sails.helpers.setting.set(key, value || '')
      if (route?.transaction)
        await sails.helpers.caddy.finishRouteUpdate.with({
          action: 'commit',
          transaction: route.transaction
        })
    } catch (error) {
      for (const [key, value] of Object.entries(before))
        await sails.helpers.setting.set(key, value || '')
      if (route?.transaction)
        await sails.helpers.caddy.finishRouteUpdate
          .with({ action: 'rollback', transaction: route.transaction })
          .catch((rollback) => {
            error.rollbackError = rollback
          })
      else if (before.instanceDomain && !desired.instanceDomain)
        await sails.helpers.caddy
          .updateDashboardRoute(before.instanceDomain)
          .catch((rollback) => {
            error.rollbackError = rollback
          })
      sails.log.warn(
        'Instance routing settings failed:',
        error.message || error
      )
      throw {
        invalid: {
          problems: [
            {
              routing: error.rollbackError
                ? 'Routing update and recovery failed. Inspect Caddy before retrying.'
                : 'Could not apply routing settings. Previous settings were preserved. Check Caddy and retry.'
            }
          ]
        }
      }
    }

    // Audit log
    await sails.helpers.audit.log.with({
      action: 'settings.updated',
      resourceType: 'settings',
      details: { section: 'instance' },
      userId: user.id,
      teamId: user.team,
      ipAddress: this.req.ip
    })

    sails.inertia.flash('success', 'Instance settings updated')
    return '/settings/instance'
  }
}
