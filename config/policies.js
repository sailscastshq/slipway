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

  // Dashboard uses special policy that checks setup status first
  'dashboard/*': 'is-authenticated-or-setup',

  // Project pages require authentication
  'project/*': 'is-authenticated-or-setup',

  // Settings pages require authentication
  'setting/*': 'is-authenticated',

  // API v1 routes require authentication
  'api/v1/*': 'is-authenticated',

  // CLI auth endpoints are public (user not logged in yet)
  'api/v1/cli/init-auth': true,
  'api/v1/cli/check-auth': true,
  'api/v1/cli/stream-auth': true,
  // confirm-auth requires auth (user confirms in browser while logged in)

  // CLI authorization page (handles its own auth state display)
  'cli/view-authorize': true
}
