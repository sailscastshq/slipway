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
  'GET /projects/new': 'project/view-new-project',
  'POST /projects': 'project/create-project',
  'GET /projects/:slug': 'project/view-project',
  'GET /projects/:slug/settings': 'project/view-project-settings',
  'PATCH /projects/:slug': 'project/update-project',
  'DELETE /projects/:slug': 'project/destroy-project',
  'GET /projects/:slug/environments/new': 'project/view-new-environment',
  'POST /projects/:slug/environments': 'project/create-environment',
  'GET /projects/:slug/environments/:envSlug': 'project/view-environment',
  'GET /projects/:slug/environments/:envSlug/settings': 'project/view-environment-settings',
  'GET /projects/:slug/environments/:envSlug/helm': 'project/view-helm',
  'GET /projects/:slug/environments/:envSlug/redis/:serviceId': 'project/view-redis-console',
  'GET /projects/:slug/deployments/:deploymentId': 'project/view-deployment',

  // Settings (web UI)
  'GET /settings': 'setting/view-settings',
  'GET /settings/cli-tokens': 'setting/view-api-keys',
  'PATCH /settings/cli-tokens/:id': 'setting/update-api-key',
  'DELETE /settings/cli-tokens/:id': 'setting/destroy-api-key',

  // Team management
  'GET /settings/team': 'team/view-members',
  'POST /settings/team/invite': 'team/invite-member',
  'PATCH /settings/team/:userId/role': 'team/update-member-role',
  'DELETE /settings/team/:userId': 'team/remove-member',
  'POST /switch-team': 'team/switch-team',
  'GET /teams/create': 'team/view-create-team',
  'POST /teams': 'team/create-team',

  // Global environment variables
  'GET /settings/global-env': 'setting/view-global-env',
  'PATCH /settings/global-env': 'setting/update-global-env',

  // Instance settings
  'GET /settings/instance': 'setting/view-instance',
  'PATCH /settings/instance': 'setting/update-instance',

  // Notifications settings
  'GET /settings/notifications': 'setting/view-notifications',
  'PATCH /settings/notifications': 'setting/update-notifications',
  'POST /settings/notifications/test': 'setting/test-notification',

  // System updates
  'GET /settings/update': 'system/view-update',
  'GET /api/v1/system/check-update': 'system/check-update',

  /***************************************************************************
   *                                                                          *
   * API v1 routes                                                            *
   *                                                                          *
   ***************************************************************************/

  // Projects
  'POST /api/v1/projects/:projectSlug/push': 'api/v1/project/push-source',
  'GET /api/v1/projects': 'api/v1/project/list-projects',
  'POST /api/v1/projects': 'api/v1/project/create-project',
  'GET /api/v1/projects/:slug': 'api/v1/project/get-project',
  'PATCH /api/v1/projects/:slug': 'api/v1/project/update-project',
  'DELETE /api/v1/projects/:slug': 'api/v1/project/destroy-project',

  // Environments (nested under projects)
  'GET /api/v1/projects/:projectSlug/environments': 'api/v1/environment/list-environments',
  'POST /api/v1/projects/:projectSlug/environments': 'api/v1/environment/create-environment',
  'GET /api/v1/projects/:projectSlug/environments/:slug': 'api/v1/environment/get-environment',
  'PATCH /api/v1/projects/:projectSlug/environments/:slug': 'api/v1/environment/update-environment',
  'DELETE /api/v1/projects/:projectSlug/environments/:slug': 'api/v1/environment/destroy-environment',

  // Deploy
  'POST /api/v1/projects/:projectSlug/deploy': 'api/v1/deploy/trigger-deployment',
  'POST /api/v1/projects/:projectSlug/environments/:environmentSlug/deploy': 'api/v1/deploy/trigger-deployment',
  'POST /api/v1/projects/:projectSlug/rollback': 'api/v1/deploy/rollback-deployment',
  'POST /api/v1/projects/:projectSlug/environments/:environmentSlug/rollback': 'api/v1/deploy/rollback-deployment',
  'GET /api/v1/deployments/:id': 'api/v1/deploy/get-deployment-status',
  'GET /api/v1/deployments/:id/logs': 'api/v1/deploy/get-deployment-logs',

  // Services
  'GET /api/v1/projects/:projectSlug/services': 'api/v1/service/list-services',
  'GET /api/v1/projects/:projectSlug/environments/:environmentSlug/services': 'api/v1/service/list-services',
  'POST /api/v1/projects/:projectSlug/services': 'api/v1/service/create-service',
  'POST /api/v1/projects/:projectSlug/environments/:environmentSlug/services': 'api/v1/service/create-service',
  'GET /api/v1/services/:id': 'api/v1/service/get-service',
  'DELETE /api/v1/services/:id': 'api/v1/service/destroy-service',
  'POST /api/v1/services/:serviceId/redis': 'api/v1/service/execute-redis-command',

  // Backups
  'POST /api/v1/services/:serviceId/backups': 'api/v1/backup/create-backup',
  'GET /api/v1/services/:serviceId/backups': 'api/v1/backup/list-backups',

  // CLI Authentication (browser-based login flow)
  'POST /api/v1/cli/auth/init': 'api/v1/cli/init-auth',
  'POST /api/v1/cli/auth/check': 'api/v1/cli/check-auth',
  'POST /api/v1/cli/auth/confirm': 'api/v1/cli/confirm-auth',
  'GET /api/v1/cli/auth/stream': 'api/v1/cli/stream-auth',
  'GET /cli/authorize': 'cli/view-authorize',

  // App lifecycle
  'POST /api/v1/projects/:projectSlug/environments/:environmentSlug/restart': 'api/v1/app/restart-app',
  'POST /api/v1/projects/:projectSlug/environments/:environmentSlug/stop': 'api/v1/app/stop-app',
  'POST /api/v1/projects/:projectSlug/environments/:environmentSlug/execute': 'api/v1/app/execute-code',

  // Webhooks (public — signature-verified in controller)
  'POST /api/v1/webhooks/github/:projectSlug': 'api/v1/webhook/github',

  // SSE Streams
  'GET /api/v1/deployments/:id/stream': 'api/v1/deploy/stream-deployment',
  'GET /api/v1/projects/:projectSlug/environments/:environmentSlug/logs/stream': 'api/v1/app/stream-container-logs',

  // Content Management (sails-content CMS)
  'GET /api/v1/projects/:projectSlug/content/collections': 'api/v1/content/list-collections',
  'GET /api/v1/projects/:projectSlug/environments/:environmentSlug/content/collections': 'api/v1/content/list-collections',
  'GET /api/v1/projects/:projectSlug/content/:collection/:file': 'api/v1/content/get-content',
  'GET /api/v1/projects/:projectSlug/environments/:environmentSlug/content/:collection/:file': 'api/v1/content/get-content',
  'POST /api/v1/projects/:projectSlug/content/:collection': 'api/v1/content/create-content',
  'POST /api/v1/projects/:projectSlug/environments/:environmentSlug/content/:collection': 'api/v1/content/create-content',
  'PUT /api/v1/projects/:projectSlug/content/:collection/:file': 'api/v1/content/update-content',
  'PUT /api/v1/projects/:projectSlug/environments/:environmentSlug/content/:collection/:file': 'api/v1/content/update-content',
  'DELETE /api/v1/projects/:projectSlug/content/:collection/:file': 'api/v1/content/delete-content',
  'DELETE /api/v1/projects/:projectSlug/environments/:environmentSlug/content/:collection/:file': 'api/v1/content/delete-content',

  // Content Manager UI
  'GET /projects/:slug/content': 'project/view-content-manager',
  'GET /projects/:slug/environments/:envSlug/content': 'project/view-content-manager',
  'GET /projects/:slug/content/:collection/:file': 'project/view-content-editor',
  'GET /projects/:slug/environments/:envSlug/content/:collection/:file': 'project/view-content-editor',

  // Quest Job Scheduler API (sails-hook-quest)
  'GET /api/v1/projects/:projectSlug/quest/jobs': 'api/v1/quest/list-jobs',
  'GET /api/v1/projects/:projectSlug/environments/:environmentSlug/quest/jobs': 'api/v1/quest/list-jobs',
  'POST /api/v1/projects/:projectSlug/quest/jobs/:name/run': 'api/v1/quest/run-job',
  'POST /api/v1/projects/:projectSlug/environments/:environmentSlug/quest/jobs/:name/run': 'api/v1/quest/run-job',
  'POST /api/v1/projects/:projectSlug/quest/jobs/:name/pause': 'api/v1/quest/pause-job',
  'POST /api/v1/projects/:projectSlug/environments/:environmentSlug/quest/jobs/:name/pause': 'api/v1/quest/pause-job',
  'POST /api/v1/projects/:projectSlug/quest/jobs/:name/resume': 'api/v1/quest/resume-job',
  'POST /api/v1/projects/:projectSlug/environments/:environmentSlug/quest/jobs/:name/resume': 'api/v1/quest/resume-job',

  // Quest UI
  'GET /projects/:slug/quest': 'project/view-quest',
  'GET /projects/:slug/environments/:envSlug/quest': 'project/view-quest',

  // Dock Database Management API
  'POST /api/v1/projects/:projectSlug/dock/sql': 'api/v1/dock/execute-sql',
  'POST /api/v1/projects/:projectSlug/environments/:environmentSlug/dock/sql': 'api/v1/dock/execute-sql',
  'GET /api/v1/projects/:projectSlug/dock/schema': 'api/v1/dock/get-schema',
  'GET /api/v1/projects/:projectSlug/environments/:environmentSlug/dock/schema': 'api/v1/dock/get-schema',
  'GET /api/v1/projects/:projectSlug/dock/models': 'api/v1/dock/get-models',
  'GET /api/v1/projects/:projectSlug/environments/:environmentSlug/dock/models': 'api/v1/dock/get-models',
  'GET /api/v1/projects/:projectSlug/dock/diff': 'api/v1/dock/get-diff',
  'GET /api/v1/projects/:projectSlug/environments/:environmentSlug/dock/diff': 'api/v1/dock/get-diff',
  'POST /api/v1/projects/:projectSlug/dock/migrate': 'api/v1/dock/apply-migration',
  'POST /api/v1/projects/:projectSlug/environments/:environmentSlug/dock/migrate': 'api/v1/dock/apply-migration',
  'GET /api/v1/projects/:projectSlug/dock/tables': 'api/v1/dock/list-tables',
  'GET /api/v1/projects/:projectSlug/environments/:environmentSlug/dock/tables': 'api/v1/dock/list-tables',
  'GET /api/v1/projects/:projectSlug/dock/tables/:table/data': 'api/v1/dock/get-table-data',
  'GET /api/v1/projects/:projectSlug/environments/:environmentSlug/dock/tables/:table/data': 'api/v1/dock/get-table-data',

  // Dock UI
  'GET /projects/:slug/dock': 'project/view-dock',
  'GET /projects/:slug/environments/:envSlug/dock': 'project/view-dock'
}
