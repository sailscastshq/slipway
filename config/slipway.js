/**
 * Slipway Configuration
 * (sails.config.slipway)
 *
 * Configuration specific to Slipway's self-hosted deployment platform.
 *
 */

const packageJson = require('../package.json')

module.exports.slipway = {
  /***************************************************************************
   *                                                                          *
   * Version information                                                      *
   *                                                                          *
   * Used for displaying current version and checking for updates.            *
   *                                                                          *
   ***************************************************************************/
  version: packageJson.version,

  /***************************************************************************
   *                                                                          *
   * Update checking                                                          *
   *                                                                          *
   * Configuration for the self-update mechanism.                             *
   *                                                                          *
   ***************************************************************************/

  // GitHub repository for checking releases
  githubRepo: 'sailscastshq/slipway',

  // How often to check for updates (in milliseconds)
  // Default: 1 hour (3600000ms)
  updateCheckInterval: 60 * 60 * 1000,

  // Whether to show update notifications in the dashboard
  showUpdateNotifications: true
}
