const {
  SUPPORTED_STATUSES,
  renderErrorPage
} = require('../../api/lib/error-pages')

module.exports = {
  // Port zero asks the OS for an unused listener. Sounding reads the actual
  // bound address after lift, so sequential worlds never share a fixed port.
  port: 0,
  hooks: {
    lookout: false,
    quest: false
  },
  log: {
    level: 'error'
  },
  models: {
    migrate: 'drop'
  },
  session: {
    adapter: '@sailscastshq/connect-sqlite',
    url: ':memory:'
  },
  datastores: {
    default: {
      adapter: 'sails-sqlite',
      url: ':memory:'
    },
    observability: {
      adapter: 'sails-sqlite',
      url: ':memory:'
    },
    cache: {
      adapter: 'sails-sqlite',
      url: ':memory:'
    }
  },
  slipway: {
    showUpdateNotifications: false
  },
  routes: {
    'GET /__sounding/errors/:status': function viewSoundingErrorPage(req, res) {
      const statusCode = Number(req.param('status'))

      if (!SUPPORTED_STATUSES.includes(statusCode)) {
        return res.notFound()
      }

      return renderErrorPage(req, res, {
        statusCode,
        error:
          statusCode >= 500
            ? new Error('Private test failure that must never reach the page')
            : null,
        inertia: req.param('inertia') === '1',
        preview: true,
        retryAfter: 60
      })
    }
  },
  mail: {
    default: 'log',
    mailers: {
      log: {
        transport: 'log'
      }
    }
  }
}
