const { test } = require('sounding')

const { routes } = require('../../../config/routes')

test('browser actions and JSON transports have explicit route contracts', ({
  expect
}) => {
  expect(
    routes[
      'GET /projects/:projectSlug/environments/:environmentSlug/logs/history'
    ]
  ).toBe(undefined)
  expect(routes['POST /projects/:slug/content/:collection/:file/images']).toBe(
    undefined
  )
  expect(
    routes[
      'POST /projects/:slug/environments/:envSlug/content/:collection/:file/images'
    ]
  ).toBe(undefined)

  expect(
    routes['POST /api/v1/projects/:slug/content/:collection/:file/images']
  ).toBe('project/content-upload-image')
  expect(
    routes[
      'POST /api/v1/projects/:slug/environments/:envSlug/content/:collection/:file/images'
    ]
  ).toBe('project/content-upload-image')
  expect(
    routes[
      'POST /api/v1/projects/:slug/environments/:envSlug/apps/:appSlug/bearing/updates/images'
    ]
  ).toBe('project/upload-bearing-update-image')
  expect(
    routes['GET /bearing/public/:projectSlug/:environmentSlug/:appSlug']
  ).toBe('bearing/redirect-to-feedback')
  expect(
    routes[
      'GET /api/v1/projects/:slug/environments/:envSlug/bridge/:modelIdentity/relationships/:relationshipAlias/options'
    ]
  ).toBe('project/bridge-relationship-options')
  expect(
    routes[
      'GET /projects/:slug/environments/:envSlug/apps/:appSlug/bridge/:modelIdentity/relationships/:relationshipAlias/options'
    ]
  ).toBe('project/bridge-relationship-options')
  expect(
    routes[
      'POST /projects/:slug/environments/:envSlug/bridge/:modelIdentity/:recordId/relationships/:relationshipAlias/:operation'
    ]
  ).toBe('project/bridge-update-relationship')
  expect(routes['POST /switch-team']).toBe('team/switch-team')
  expect(routes['POST /settings/notifications/test']).toBe(
    'setting/test-notification'
  )
  expect(routes['DELETE /settings/team-profile/logo']).toBe(
    'team/delete-team-logo'
  )
  expect(
    routes[
      'GET /api/v1/projects/:projectSlug/environments/:environmentSlug/helm/completions'
    ]
  ).toBe('api/v1/helm/get-project-completions')
  expect(routes['GET /api/v1/bosun/helm/completions']).toBe(
    'api/v1/bosun/get-helm-completions'
  )
})
