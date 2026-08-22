/**
 * Inertia configuration
 * (sails.config.inertia)
 *
 * For more information on Inertia configuration, visit:
 * https://docs.sailscasts.com/inertia-sails/
 */

module.exports.inertia = {
  errorPage: 'errors/status',
  errorStatuses: [403, 404, 419, 429, 500, 503]
}
