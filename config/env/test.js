module.exports = {
  port: 3333,
  hooks: {
    // Uncomment if you have the apianalytics hook and you don't want to see logs
    // from it during testing
    // apianalytics: false
  },
  log: {
    level: 'error'
  },
  models: {
    migrate: 'drop'
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
  mail: {
    default: 'log',
    mailers: {
      log: {
        transport: 'log'
      }
    }
  }
}
