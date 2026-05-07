module.exports = {
  port: 3333,
  hooks: {
    lookout: false,
    quest: false,
    sockets: false,
    pubsub: false
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
  mail: {
    default: 'log',
    mailers: {
      log: {
        transport: 'log'
      }
    }
  }
}
