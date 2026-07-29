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
  'GET /projects/:slug/environments/:envSlug/settings':
    'project/view-environment-settings',
  'GET /projects/:slug/environments/:envSlug/apps/:appSlug': 'project/view-app',
  'GET /projects/:slug/environments/:envSlug/apps/:appSlug/settings':
    'project/view-app-settings',
  'GET /projects/:slug/environments/:envSlug/helm': 'project/view-helm',
  'GET /projects/:slug/environments/:envSlug/services/:serviceId':
    'project/view-service',
  'GET /projects/:slug/environments/:envSlug/services/:serviceId/settings':
    'project/view-service-settings',
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

  // File storage settings
  'GET /settings/uploads': 'setting/view-uploads',
  'PATCH /settings/uploads': 'setting/update-uploads',

  // Team profile settings
  'GET /settings/team-profile': 'team/view-team-profile',
  'PATCH /settings/team-profile': 'team/update-team-profile',
  'POST /settings/team-profile/logo': 'team/upload-team-logo',
  'DELETE /settings/team-profile/logo': 'team/delete-team-logo',

  // Audit log
  'GET /settings/audit-log': 'setting/view-audit-log',

  // Notifications settings
  'GET /settings/notifications': 'setting/view-notifications',
  'PATCH /settings/notifications': 'setting/update-notifications',
  'POST /settings/notifications/test': 'setting/test-notification',

  // System updates
  'GET /settings/update': 'system/view-update',
  'GET /api/v1/system/check-update': 'system/check-update',
  'POST /api/v1/system/apply-update': 'system/apply-update',
  'GET /api/v1/system/stream-update': 'system/stream-update',

  // Bosun (self-administration dashboard)
  'GET /bosun': 'bosun/view-bosun',

  // Lookout (infrastructure observability)
  'GET /lookout': 'lookout/view-lookout',
  'GET /projects/:slug/lookout': 'project/view-lookout',
  'GET /projects/:slug/environments/:envSlug/lookout': 'project/view-lookout',

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
  'GET /api/v1/projects/:projectSlug/environments':
    'api/v1/environment/list-environments',
  'POST /api/v1/projects/:projectSlug/environments':
    'api/v1/environment/create-environment',
  'GET /api/v1/projects/:projectSlug/environments/:slug':
    'api/v1/environment/get-environment',
  'PATCH /api/v1/projects/:projectSlug/environments/:slug':
    'api/v1/environment/update-environment',
  'DELETE /api/v1/projects/:projectSlug/environments/:slug':
    'api/v1/environment/destroy-environment',

  // Deploy
  'POST /api/v1/projects/:projectSlug/deploy':
    'api/v1/deploy/trigger-deployment',
  'POST /api/v1/projects/:projectSlug/environments/:environmentSlug/deploy':
    'api/v1/deploy/trigger-deployment',
  'POST /api/v1/projects/:projectSlug/rollback':
    'api/v1/deploy/rollback-deployment',
  'POST /api/v1/projects/:projectSlug/environments/:environmentSlug/rollback':
    'api/v1/deploy/rollback-deployment',
  'POST /api/v1/deployments/:deploymentId/cancel':
    'api/v1/deploy/cancel-deployment',
  'GET /api/v1/deployments/active': 'api/v1/deploy/get-active-deployments',
  'GET /api/v1/deployments/:id': 'api/v1/deploy/get-deployment-status',
  'GET /api/v1/deployments/:id/logs': 'api/v1/deploy/get-deployment-logs',

  // Services
  'GET /api/v1/service-versions': 'api/v1/service/list-versions',
  'GET /api/v1/projects/:projectSlug/services': 'api/v1/service/list-services',
  'GET /api/v1/projects/:projectSlug/environments/:environmentSlug/services':
    'api/v1/service/list-services',
  'POST /api/v1/projects/:projectSlug/services':
    'api/v1/service/create-service',
  'POST /api/v1/projects/:projectSlug/environments/:environmentSlug/services':
    'api/v1/service/create-service',
  'GET /api/v1/services/:id': 'api/v1/service/get-service',
  'DELETE /api/v1/services/:id': 'api/v1/service/destroy-service',
  'POST /api/v1/services/:serviceId/redis':
    'api/v1/service/execute-redis-command',
  'GET /api/v1/services/:serviceId/logs/stream': 'api/v1/service/stream-logs',
  'POST /api/v1/services/:serviceId/stop': 'api/v1/service/stop-service',
  'POST /api/v1/services/:serviceId/start': 'api/v1/service/restart-service',
  'POST /api/v1/services/:serviceId/restart': 'api/v1/service/restart-service',
  'POST /api/v1/services/:serviceId/upgrade': 'api/v1/service/upgrade-service',
  'GET /api/v1/services/:serviceId/upgrade/stream':
    'api/v1/service/stream-upgrade',
  'PATCH /api/v1/services/:serviceId': 'api/v1/service/update-service',

  // Backups
  'POST /api/v1/services/:serviceId/backups': 'api/v1/backup/create-backup',
  'GET /api/v1/services/:serviceId/backups': 'api/v1/backup/list-backups',
  'POST /api/v1/backups/:backupId/restore': 'api/v1/backup/restore-backup',
  'GET /api/v1/backups/:backupId/stream': 'api/v1/backup/stream-status',
  'POST /backups/:backupId/restore': 'project/restore-backup',

  // Audit logs
  'GET /api/v1/audit-logs': 'api/v1/audit-log/list-audit-logs',

  // CLI Authentication (browser-based login flow)
  'POST /api/v1/cli/auth/init': {
    action: 'api/v1/cli/init-auth',
    csrf: false
  },
  'POST /api/v1/cli/auth/check': {
    action: 'api/v1/cli/check-auth',
    csrf: false
  },
  'POST /api/v1/cli/auth/confirm': 'api/v1/cli/confirm-auth',
  'GET /api/v1/cli/auth/stream': 'api/v1/cli/stream-auth',
  'GET /cli/authorize': 'cli/view-authorize',

  // App CRUD (multi-app)
  'POST /projects/:slug/environments/:envSlug/apps': 'project/create-app',
  'GET /api/v1/projects/:projectSlug/environments/:environmentSlug/apps':
    'api/v1/app/list-apps',
  'PATCH /api/v1/projects/:projectSlug/environments/:environmentSlug/apps/:appSlug':
    'api/v1/app/update-app',
  'DELETE /api/v1/projects/:projectSlug/environments/:environmentSlug/apps/:appSlug':
    'api/v1/app/destroy-app',

  // App-scoped deploy/lifecycle
  'POST /api/v1/projects/:projectSlug/environments/:environmentSlug/apps/:appSlug/deploy':
    'api/v1/deploy/trigger-deployment',
  'POST /api/v1/projects/:projectSlug/environments/:environmentSlug/apps/:appSlug/restart':
    'api/v1/app/restart-app',
  'POST /api/v1/projects/:projectSlug/environments/:environmentSlug/apps/:appSlug/stop':
    'api/v1/app/stop-app',
  'GET /api/v1/projects/:projectSlug/environments/:environmentSlug/apps/:appSlug/logs/stream':
    'api/v1/app/stream-container-logs',

  // App lifecycle (environment-scoped — targets default app)
  'POST /api/v1/projects/:projectSlug/environments/:environmentSlug/restart':
    'api/v1/app/restart-app',
  'POST /api/v1/projects/:projectSlug/environments/:environmentSlug/stop':
    'api/v1/app/stop-app',
  'POST /api/v1/projects/:projectSlug/environments/:environmentSlug/execute':
    'api/v1/app/execute-code',
  'POST /api/v1/projects/:projectSlug/environments/:environmentSlug/helm/arm-writes':
    'api/v1/helm/arm-writes',
  'POST /api/v1/projects/:projectSlug/environments/:environmentSlug/helm/inspect-source':
    'api/v1/helm/inspect-source',
  'GET /api/v1/projects/:projectSlug/environments/:environmentSlug/helm/completions':
    'api/v1/helm/get-project-completions',
  'GET /api/v1/projects/:projectSlug/environments/:environmentSlug/helm/history':
    'api/v1/helm/list-history',
  'PATCH /api/v1/projects/:projectSlug/environments/:environmentSlug/helm/history/:id':
    'api/v1/helm/update-history-entry',
  'DELETE /api/v1/projects/:projectSlug/environments/:environmentSlug/helm/history/:id':
    'api/v1/helm/delete-history-entry',
  'DELETE /api/v1/projects/:projectSlug/environments/:environmentSlug/helm/history':
    'api/v1/helm/clear-history',
  'GET /api/v1/projects/:projectSlug/environments/:environmentSlug/helm/snippets':
    'api/v1/helm/list-snippets',
  'POST /api/v1/projects/:projectSlug/environments/:environmentSlug/helm/snippets':
    'api/v1/helm/create-snippet',
  'PATCH /api/v1/projects/:projectSlug/environments/:environmentSlug/helm/snippets/:id':
    'api/v1/helm/update-snippet',
  'DELETE /api/v1/projects/:projectSlug/environments/:environmentSlug/helm/snippets/:id':
    'api/v1/helm/delete-snippet',

  // Webhooks (public — signature-verified in controller)
  'POST /api/v1/webhooks/github/:projectSlug': {
    action: 'api/v1/webhook/github',
    csrf: false
  },

  // SSE Streams
  'GET /api/v1/deployments/active/stream':
    'api/v1/deploy/stream-active-deployments',
  'GET /api/v1/deployments/:id/stream': 'api/v1/deploy/stream-deployment',
  'GET /api/v1/projects/:projectSlug/environments/:environmentSlug/logs/stream':
    'api/v1/app/stream-container-logs',

  // Content Manager UI
  'GET /projects/:slug/content': 'project/view-content-manager',
  'GET /projects/:slug/environments/:envSlug/content':
    'project/view-content-manager',
  'GET /projects/:slug/content/:collection/:file':
    'project/view-content-editor',
  'GET /projects/:slug/environments/:envSlug/content/:collection/:file':
    'project/view-content-editor',

  // Content Actions (Inertia form submissions)
  'POST /projects/:slug/content/:collection/create': 'project/content-create',
  'POST /projects/:slug/environments/:envSlug/content/:collection/create':
    'project/content-create',
  'POST /projects/:slug/content/:collection/:file/update':
    'project/content-update',
  'POST /projects/:slug/environments/:envSlug/content/:collection/:file/update':
    'project/content-update',
  // Content editor transport (returns the uploaded image URL immediately)
  'POST /api/v1/projects/:slug/content/:collection/:file/images':
    'project/content-upload-image',
  'POST /api/v1/projects/:slug/environments/:envSlug/content/:collection/:file/images':
    'project/content-upload-image',
  'POST /projects/:slug/content/:collection/:file/delete':
    'project/content-delete',
  'POST /projects/:slug/environments/:envSlug/content/:collection/:file/delete':
    'project/content-delete',

  // Quest Job Scheduler API (run-job needed for inline output)
  'POST /api/v1/projects/:projectSlug/quest/jobs/:name/run':
    'api/v1/quest/run-job',
  'POST /api/v1/projects/:projectSlug/environments/:environmentSlug/quest/jobs/:name/run':
    'api/v1/quest/run-job',

  // Quest SSE Stream
  'GET /api/v1/projects/:projectSlug/quest/stream': 'api/v1/quest/stream-jobs',
  'GET /api/v1/projects/:projectSlug/environments/:environmentSlug/quest/stream':
    'api/v1/quest/stream-jobs',

  // Quest UI
  'GET /projects/:slug/quest': 'project/view-quest',
  'GET /projects/:slug/environments/:envSlug/quest': 'project/view-quest',

  // Quest Actions (Inertia form submissions)
  'POST /projects/:slug/quest/:jobName/pause': 'project/quest-pause-job',
  'POST /projects/:slug/environments/:envSlug/quest/:jobName/pause':
    'project/quest-pause-job',
  'POST /projects/:slug/quest/:jobName/resume': 'project/quest-resume-job',
  'POST /projects/:slug/environments/:envSlug/quest/:jobName/resume':
    'project/quest-resume-job',

  // Dock Database Management API
  'POST /api/v1/projects/:projectSlug/dock/sql': 'api/v1/dock/execute-sql',
  'POST /api/v1/projects/:projectSlug/environments/:environmentSlug/dock/sql':
    'api/v1/dock/execute-sql',
  'GET /api/v1/projects/:projectSlug/dock/schema': 'api/v1/dock/get-schema',
  'GET /api/v1/projects/:projectSlug/environments/:environmentSlug/dock/schema':
    'api/v1/dock/get-schema',
  'GET /api/v1/projects/:projectSlug/dock/models': 'api/v1/dock/get-models',
  'GET /api/v1/projects/:projectSlug/environments/:environmentSlug/dock/models':
    'api/v1/dock/get-models',
  'GET /api/v1/projects/:projectSlug/dock/diff': 'api/v1/dock/get-diff',
  'GET /api/v1/projects/:projectSlug/environments/:environmentSlug/dock/diff':
    'api/v1/dock/get-diff',
  'POST /api/v1/projects/:projectSlug/dock/migrate':
    'api/v1/dock/apply-migration',
  'POST /api/v1/projects/:projectSlug/environments/:environmentSlug/dock/migrate':
    'api/v1/dock/apply-migration',
  'GET /api/v1/projects/:projectSlug/dock/tables': 'api/v1/dock/list-tables',
  'GET /api/v1/projects/:projectSlug/environments/:environmentSlug/dock/tables':
    'api/v1/dock/list-tables',
  'GET /api/v1/projects/:projectSlug/dock/tables/:table/data':
    'api/v1/dock/get-table-data',
  'GET /api/v1/projects/:projectSlug/environments/:environmentSlug/dock/tables/:table/data':
    'api/v1/dock/get-table-data',
  'POST /api/v1/projects/:projectSlug/dock/export':
    'api/v1/dock/export-database',
  'POST /api/v1/projects/:projectSlug/environments/:environmentSlug/dock/export':
    'api/v1/dock/export-database',
  'POST /api/v1/projects/:projectSlug/dock/import': 'api/v1/dock/import-sql',
  'POST /api/v1/projects/:projectSlug/environments/:environmentSlug/dock/import':
    'api/v1/dock/import-sql',

  // Dock UI (serviceId is optional - without it shows service picker)
  'GET /projects/:slug/dock/:serviceId?': 'project/view-dock',
  'GET /projects/:slug/environments/:envSlug/dock/:serviceId?':
    'project/view-dock',

  // Bridge UI
  'GET /bridge/launch': 'bridge/launch',
  'POST /api/v1/bridge/exchange': {
    action: 'api/v1/bridge/exchange',
    csrf: false
  },
  'GET /projects/:slug/environments/:envSlug/apps/:appSlug/bridge/access':
    'project/view-bridge-access',
  'PATCH /projects/:slug/environments/:envSlug/apps/:appSlug/bridge/access':
    'project/update-bridge-settings',
  'POST /projects/:slug/environments/:envSlug/apps/:appSlug/bridge/access/invitations':
    'project/invite-bridge-user',
  'PATCH /projects/:slug/environments/:envSlug/apps/:appSlug/bridge/access/:accessId':
    'project/update-bridge-access',
  'DELETE /projects/:slug/environments/:envSlug/apps/:appSlug/bridge/access/:accessId':
    'project/revoke-bridge-access',
  'GET /projects/:slug/environments/:envSlug/apps/:appSlug/bridge':
    'project/view-bridge',
  'GET /projects/:slug/environments/:envSlug/apps/:appSlug/bridge/:modelIdentity':
    'project/view-bridge-model',
  'GET /projects/:slug/environments/:envSlug/apps/:appSlug/bridge/:modelIdentity/new':
    'project/view-bridge-create',
  'GET /projects/:slug/environments/:envSlug/apps/:appSlug/bridge/:modelIdentity/:recordId':
    'project/view-bridge-record',
  'GET /projects/:slug/environments/:envSlug/apps/:appSlug/bridge/:modelIdentity/:recordId/edit':
    'project/view-bridge-edit',
  'POST /projects/:slug/environments/:envSlug/apps/:appSlug/bridge/:modelIdentity/create':
    'project/bridge-create-record',
  'POST /projects/:slug/environments/:envSlug/apps/:appSlug/bridge/:modelIdentity/:fieldName/upload':
    'project/bridge-upload-field',
  'POST /projects/:slug/environments/:envSlug/apps/:appSlug/bridge/:modelIdentity/:recordId/update':
    'project/bridge-update-record',
  'POST /projects/:slug/environments/:envSlug/apps/:appSlug/bridge/:modelIdentity/:recordId/delete':
    'project/bridge-delete-record',
  'POST /projects/:slug/environments/:envSlug/apps/:appSlug/bridge/:modelIdentity/bulk-delete':
    'project/bridge-bulk-delete',
  'POST /projects/:slug/environments/:envSlug/apps/:appSlug/bridge/:modelIdentity/actions/:actionName':
    'project/bridge-execute-action',
  'GET /api/v1/projects/:slug/environments/:envSlug/apps/:appSlug/bridge/:modelIdentity/relationships/:relationshipAlias/options':
    'project/bridge-relationship-options',
  'POST /projects/:slug/environments/:envSlug/apps/:appSlug/bridge/:modelIdentity/:recordId/relationships/:relationshipAlias/:operation':
    'project/bridge-update-relationship',
  'GET /projects/:slug/bridge': 'project/view-bridge',
  'GET /projects/:slug/environments/:envSlug/bridge': 'project/view-bridge',
  'GET /projects/:slug/bridge/:modelIdentity': 'project/view-bridge-model',
  'GET /projects/:slug/environments/:envSlug/bridge/:modelIdentity':
    'project/view-bridge-model',
  'GET /projects/:slug/bridge/:modelIdentity/new': 'project/view-bridge-create',
  'GET /projects/:slug/environments/:envSlug/bridge/:modelIdentity/new':
    'project/view-bridge-create',
  'GET /projects/:slug/bridge/:modelIdentity/:recordId':
    'project/view-bridge-record',
  'GET /projects/:slug/environments/:envSlug/bridge/:modelIdentity/:recordId':
    'project/view-bridge-record',
  'GET /projects/:slug/bridge/:modelIdentity/:recordId/edit':
    'project/view-bridge-edit',
  'GET /projects/:slug/environments/:envSlug/bridge/:modelIdentity/:recordId/edit':
    'project/view-bridge-edit',

  // Bridge Actions (Inertia form submissions)
  'POST /projects/:slug/bridge/:modelIdentity/create':
    'project/bridge-create-record',
  'POST /projects/:slug/environments/:envSlug/bridge/:modelIdentity/create':
    'project/bridge-create-record',
  'POST /projects/:slug/bridge/:modelIdentity/:fieldName/upload':
    'project/bridge-upload-field',
  'POST /projects/:slug/environments/:envSlug/bridge/:modelIdentity/:fieldName/upload':
    'project/bridge-upload-field',
  'POST /projects/:slug/bridge/:modelIdentity/:recordId/update':
    'project/bridge-update-record',
  'POST /projects/:slug/environments/:envSlug/bridge/:modelIdentity/:recordId/update':
    'project/bridge-update-record',
  'POST /projects/:slug/bridge/:modelIdentity/:recordId/delete':
    'project/bridge-delete-record',
  'POST /projects/:slug/environments/:envSlug/bridge/:modelIdentity/:recordId/delete':
    'project/bridge-delete-record',
  'POST /projects/:slug/bridge/:modelIdentity/bulk-delete':
    'project/bridge-bulk-delete',
  'POST /projects/:slug/environments/:envSlug/bridge/:modelIdentity/bulk-delete':
    'project/bridge-bulk-delete',
  'POST /projects/:slug/bridge/:modelIdentity/actions/:actionName':
    'project/bridge-execute-action',
  'POST /projects/:slug/environments/:envSlug/bridge/:modelIdentity/actions/:actionName':
    'project/bridge-execute-action',
  // Bridge relationship search is JSON transport for async comboboxes.
  'GET /api/v1/projects/:slug/bridge/:modelIdentity/relationships/:relationshipAlias/options':
    'project/bridge-relationship-options',
  'GET /api/v1/projects/:slug/environments/:envSlug/bridge/:modelIdentity/relationships/:relationshipAlias/options':
    'project/bridge-relationship-options',
  'POST /projects/:slug/bridge/:modelIdentity/:recordId/relationships/:relationshipAlias/:operation':
    'project/bridge-update-relationship',
  'POST /projects/:slug/environments/:envSlug/bridge/:modelIdentity/:recordId/relationships/:relationshipAlias/:operation':
    'project/bridge-update-relationship',

  /***************************************************************************
   *                                                                          *
   * Git Integration & Push-to-Deploy                                         *
   *                                                                          *
   ***************************************************************************/

  // GitHub OAuth
  'GET /auth/github': 'auth/github',
  'GET /auth/github/callback': 'auth/github-callback',

  // Git Settings UI
  'GET /settings/git': 'setting/view-git',
  'PATCH /settings/git': 'setting/update-git',

  // Git API
  'GET /api/v1/git/repos': 'api/v1/git/list-repos',
  'GET /api/v1/git/branches': 'api/v1/git/list-branches',
  'GET /api/v1/git/status': 'api/v1/git/get-status',

  // Git Integration (Inertia form submissions)
  'POST /projects/:slug/environments/:envSlug/apps/:appSlug/connect-repo':
    'project/connect-repo',
  'DELETE /projects/:slug/environments/:envSlug/apps/:appSlug/disconnect-repo':
    'project/disconnect-repo',
  'PATCH /projects/:slug/environments/:envSlug/apps/:appSlug/repo':
    'project/update-repo',

  // Deploy Tokens
  'GET /api/v1/deploy-tokens': 'api/v1/deploy-token/list',
  'POST /api/v1/deploy-tokens': 'api/v1/deploy-token/create',
  'DELETE /api/v1/deploy-tokens/:id': 'api/v1/deploy-token/revoke',

  // Bosun API (self-administration)
  'POST /api/v1/bosun/sql': 'api/v1/bosun/execute-sql',
  'GET /api/v1/bosun/diff': 'api/v1/bosun/get-diff',
  'POST /api/v1/bosun/migrate': 'api/v1/bosun/apply-migration',
  'POST /api/v1/bosun/eval': 'api/v1/bosun/eval',
  'GET /api/v1/bosun/helm/completions': 'api/v1/bosun/get-helm-completions',
  'POST /api/v1/helm/executions/:executionId/cancel':
    'api/v1/helm/cancel-execution',
  'GET /api/v1/bosun/activity': 'api/v1/bosun/get-activity',
  'PATCH /api/v1/bosun/env': 'api/v1/bosun/update-env',
  'GET /api/v1/bosun/logs/stream': 'api/v1/bosun/stream-instance-logs',

  // Lookout API (infrastructure metrics)
  'GET /api/v1/lookout/overview': 'api/v1/lookout/get-overview',
  'GET /api/v1/lookout/metrics/:containerName':
    'api/v1/lookout/get-container-metrics',
  'GET /api/v1/projects/:projectSlug/lookout':
    'api/v1/lookout/get-environment-metrics',
  'GET /api/v1/projects/:projectSlug/environments/:environmentSlug/lookout':
    'api/v1/lookout/get-environment-metrics',
  'GET /api/v1/projects/:projectSlug/environments/:environmentSlug/lookout/stream':
    'api/v1/lookout/stream-metrics',

  // Telemetry API (app observability)
  'POST /api/v1/telemetry/ingest': {
    action: 'api/v1/telemetry/ingest',
    csrf: false
  },
  'GET /api/v1/projects/:projectSlug/telemetry/spans':
    'api/v1/telemetry/get-spans',
  'GET /api/v1/projects/:projectSlug/environments/:environmentSlug/telemetry/spans':
    'api/v1/telemetry/get-spans',
  'GET /api/v1/projects/:projectSlug/telemetry/exceptions':
    'api/v1/telemetry/get-exceptions',
  'GET /api/v1/projects/:projectSlug/environments/:environmentSlug/telemetry/exceptions':
    'api/v1/telemetry/get-exceptions',
  'GET /api/v1/projects/:projectSlug/telemetry/metrics':
    'api/v1/telemetry/get-metrics',
  'GET /api/v1/projects/:projectSlug/environments/:environmentSlug/telemetry/metrics':
    'api/v1/telemetry/get-metrics',

  // Webhooks (public endpoints - signature verified in controller)
  'POST /webhook/github': {
    action: 'webhook/github',
    csrf: false
  }
}
