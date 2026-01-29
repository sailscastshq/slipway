/**
 * Route Mappings
 * (sails.config.routes)
 *
 * Your routes tell Sails what to do each time it receives a request.
 *
 * For more information on configuring custom routes, check out:
 * http://sailsjs.com/anatomy/config/routes-js
 */

module.exports.routes = {
  /***************************************************************************
   *                                                                          *
   * Custom routes here...                                                    *
   *                                                                          *
   * If a request to a URL doesn't match any of the custom routes above, it   *
   * is matched against Sails route blueprints. See `config/blueprints.js`    *
   * for configuration options and examples.                                  *
   *                                                                          *
   **********************************************/
  'GET /health': 'health/check',

  // Dashboard (root route - redirects to /setup if not configured)
  'GET /': 'dashboard/view-dashboard',

  // Setup (only accessible when no genesis user exists)
  'GET /setup': 'setup/view-setup',
  'POST /setup': 'setup/complete-setup',

  'GET /check-email': 'auth/view-check-email',
  'GET /verify-email': 'auth/verify-email',

  'GET /link-expired': 'auth/view-link-expired',
  'GET /resend-link': 'auth/resend-link',

  'GET /:operation/success': 'auth/view-success',

  'GET /login': 'auth/view-login',
  'POST /login': 'auth/login',

  'GET /forgot-password': 'auth/view-forgot-password',
  'POST /forgot-password': 'auth/forgot-password',

  'GET /reset-password': 'auth/view-reset-password',
  'POST /reset-password': 'auth/reset-password',

  'GET /profile': 'user/view-profile',
  'PATCH /profile': 'user/update-profile',
  'DELETE /profile': 'user/delete-profile',

  'DELETE /logout': 'user/logout',

  // Projects (web UI)
  'GET /projects/new': 'projects/view-new-project',
  'POST /projects': 'projects/create-project',
  'GET /projects/:slug': 'projects/view-project',
  'GET /projects/:slug/settings': 'projects/view-project-settings',
  'PATCH /projects/:slug': 'projects/update-project',
  'DELETE /projects/:slug': 'projects/destroy-project',
  'GET /projects/:slug/environments/:envSlug': 'projects/view-environment',
  'GET /projects/:slug/deployments/:deploymentId': 'projects/view-deployment',

  /***************************************************************************
   *                                                                          *
   * API v1 routes                                                            *
   *                                                                          *
   ***************************************************************************/

  // Projects
  'GET /api/v1/projects': 'api/v1/projects/list-projects',
  'POST /api/v1/projects': 'api/v1/projects/create-project',
  'GET /api/v1/projects/:id': 'api/v1/projects/get-project',
  'PATCH /api/v1/projects/:id': 'api/v1/projects/update-project',
  'DELETE /api/v1/projects/:id': 'api/v1/projects/destroy-project',

  // Environments (nested under projects)
  'GET /api/v1/projects/:projectId/environments': 'api/v1/environments/list-environments',
  'POST /api/v1/projects/:projectId/environments': 'api/v1/environments/create-environment',
  'GET /api/v1/projects/:projectId/environments/:id': 'api/v1/environments/get-environment',
  'PATCH /api/v1/projects/:projectId/environments/:id': 'api/v1/environments/update-environment',
  'DELETE /api/v1/projects/:projectId/environments/:id': 'api/v1/environments/destroy-environment',

  // Deploy
  'POST /api/v1/projects/:projectId/environments/:environmentId/deploy': 'api/v1/deploy/trigger-deployment',
  'GET /api/v1/deployments/:id': 'api/v1/deploy/get-deployment-status',
  'GET /api/v1/deployments/:id/logs': 'api/v1/deploy/get-deployment-logs',

  // Services (databases, redis, etc.)
  'GET /api/v1/projects/:projectId/environments/:environmentId/services': 'api/v1/services/list-services',
  'POST /api/v1/projects/:projectId/environments/:environmentId/services': 'api/v1/services/create-service',
  'GET /api/v1/services/:id': 'api/v1/services/get-service',
  'DELETE /api/v1/services/:id': 'api/v1/services/destroy-service',

  // CLI Authentication (browser-based login flow)
  'POST /api/v1/cli/auth/init': 'api/v1/cli/init-auth',
  'POST /api/v1/cli/auth/check': 'api/v1/cli/check-auth',
  'POST /api/v1/cli/auth/confirm': 'api/v1/cli/confirm-auth',
  'GET /api/v1/cli/auth/stream': 'api/v1/cli/stream-auth',
  'GET /cli/authorize': 'cli/view-authorize',

  // SSE Streams
  'GET /api/v1/deployments/:id/stream': 'api/v1/deploy/stream-deployment'
}
