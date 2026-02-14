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
      description: 'Email address for Let\'s Encrypt ACME certificate provisioning'
    }
  },

  exits: {
    success: {
      responseType: 'inertiaRedirect'
    }
  },

  fn: async function ({ instanceDomain, instanceName, acmeEmail }) {
    if (instanceDomain !== undefined) {
      // Clean up the domain - remove protocol and trailing slashes
      let cleanDomain = instanceDomain.trim()
        .replace(/^https?:\/\//, '')
        .replace(/\/+$/, '')
      await sails.helpers.setting.set('instanceDomain', cleanDomain)
    }

    if (instanceName !== undefined) {
      await sails.helpers.setting.set('instanceName', instanceName.trim())
    }

    if (acmeEmail !== undefined) {
      const cleanEmail = acmeEmail.trim()
      await sails.helpers.setting.set('acmeEmail', cleanEmail)

      // Configure Caddy TLS if email is provided
      if (cleanEmail) {
        try {
          await sails.helpers.caddy.configureTls.with({ acmeEmail: cleanEmail })
        } catch (err) {
          sails.log.warn('Failed to configure Caddy TLS:', err.message)
        }
      }
    }

    // Audit log
    const user = await User.findOne({ id: this.req.session.userId })
    await sails.helpers.audit.log.with({
      action: 'settings.updated',
      resourceType: 'settings',
      details: { section: 'instance' },
      userId: user.id,
      teamId: user.team,
      ipAddress: this.req.ip
    })

    this.req._sails.inertia.flash('success', 'Instance settings updated')
    return '/settings/instance'
  }
}
