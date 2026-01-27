/**
 * sails-hook-slipway
 *
 * Provides admin panel, console (REPL), and telemetry for Sails apps
 * deployed with Slipway.
 */

module.exports = function defineSlipwayHook(sails) {
  return {
    defaults: {
      slipway: {
        // Enable/disable features
        admin: {
          enabled: true,
          path: '/_slipway/admin'
        },
        console: {
          enabled: true,
          path: '/_slipway/console'
        },
        telemetry: {
          enabled: true,
          endpoint: process.env.SLIPWAY_TELEMETRY_URL || null
        }
      }
    },

    configure: function () {
      // Expose slipway config
      sails.config.slipway = sails.config.slipway || {}
    },

    initialize: async function () {
      const config = sails.config.slipway

      sails.log.info('sails-hook-slipway: Initializing...')

      // Initialize telemetry if configured
      if (config.telemetry.enabled && config.telemetry.endpoint) {
        await this.initTelemetry(config.telemetry)
      }

      sails.log.info('sails-hook-slipway: Ready')
    },

    initTelemetry: async function (telemetryConfig) {
      try {
        // OpenTelemetry setup will go here
        sails.log.verbose('sails-hook-slipway: Telemetry initialized')
      } catch (err) {
        sails.log.warn('sails-hook-slipway: Failed to initialize telemetry:', err.message)
      }
    },

    routes: {
      before: {
        // Admin panel
        'GET /_slipway/admin': function (req, res, next) {
          if (!sails.config.slipway.admin.enabled) {
            return next()
          }
          // TODO: Render admin panel
          res.json({ message: 'Slipway Admin Panel - Coming Soon' })
        },

        // Console (REPL)
        'GET /_slipway/console': function (req, res, next) {
          if (!sails.config.slipway.console.enabled) {
            return next()
          }
          // TODO: Render console
          res.json({ message: 'Slipway Console - Coming Soon' })
        },

        // Health check for Slipway
        'GET /_slipway/health': function (req, res) {
          res.json({
            status: 'ok',
            sails: sails.config.environment,
            uptime: process.uptime()
          })
        },

        // Models list (for admin panel)
        'GET /_slipway/api/models': function (req, res, next) {
          if (!sails.config.slipway.admin.enabled) {
            return next()
          }

          const models = Object.keys(sails.models).map(identity => ({
            identity,
            globalId: sails.models[identity].globalId,
            attributes: Object.keys(sails.models[identity].attributes)
          }))

          res.json({ models })
        }
      }
    }
  }
}
