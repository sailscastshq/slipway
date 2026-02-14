/**
 * Cachestores
 * (sails.config.cachestores)
 *
 * Configure cache stores for sails-stash.
 *
 * For more information on configuring cache stores, check out:
 * https://docs.sailscasts.com/sails-stash/configuration
 */

module.exports.cachestores = {
  default: {
    store: 'sqlite',
    datastore: 'cache'
  }
}
