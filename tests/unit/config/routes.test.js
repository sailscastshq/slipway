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
  expect(routes['POST /switch-team']).toBe('team/switch-team')
  expect(routes['POST /settings/notifications/test']).toBe(
    'setting/test-notification'
  )
  expect(routes['DELETE /settings/team-profile/logo']).toBe(
    'team/delete-team-logo'
  )
})
