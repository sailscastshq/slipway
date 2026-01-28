/**
 * Policy Mappings
 * (sails.config.policies)
 *
 * Policies are simple functions which run **before** your actions.
 *
 * For more information on configuring policies, check out:
 * https://sailsjs.com/docs/concepts/policies
 */

module.exports.policies = {
  /***************************************************************************
   *                                                                          *
   * Default policy for all controllers and actions, unless overridden.       *
   * (`true` allows public access)                                            *
   *                                                                          *
   ***************************************************************************/

  // Setup only allowed when no genesis user exists
  'setup/*': 'is-setup-allowed',

  // Auth routes for guests only (except when setup is needed)
  'auth/*': 'is-guest',
  'auth/view-success': true,

  // Authenticated routes
  'user/*': 'is-authenticated',
  'dashboard/*': 'is-authenticated',

  // API v1 routes require authentication
  'api/v1/*': 'is-authenticated'
}
