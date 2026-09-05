const { test } = require('sounding')
const { withCsrfFromPage } = require('../../support/csrf-request')

const protectedRoutes = [
  ['get', '/bosun'],
  ['get', '/settings/instance'],
  ['get', '/settings/global-env'],
  ['get', '/settings/uploads'],
  ['get', '/settings/notifications'],
  ['get', '/settings/update'],
  ['get', '/api/v1/bosun/activity'],
  ['get', '/api/v1/bosun/logs/stream'],
  ['get', '/api/v1/bosun/diff'],
  ['get', '/api/v1/bosun/helm/completions'],
  ['post', '/api/v1/bosun/eval', { code: '1+1' }],
  ['post', '/api/v1/bosun/sql', { query: 'SELECT 1' }],
  ['post', '/api/v1/bosun/migrate', {}],
  ['patch', '/api/v1/bosun/env', { envVars: {} }],
  ['patch', '/settings/instance', { instanceName: 'Forbidden change' }],
  ['patch', '/settings/global-env', { envVars: {} }],
  ['patch', '/settings/uploads', {}],
  ['patch', '/settings/notifications', {}],
  ['post', '/settings/notifications/test', {}],
  ['patch', '/settings/git', {}],
  ['post', '/api/v1/system/apply-update', {}],
  ['get', '/api/v1/system/stream-update'],
  ['get', '/api/v1/system/check-update']
]

test(
  'instance operations reject every team role before executing actions',
  { world: 'configured-slipway' },
  async ({ sails, world, request, expect }) => {
    const id = world.current.users.genesisUser.id
    const browser = await withCsrfFromPage(request, '/settings', 'genesisUser')
    const originalName = await sails.helpers.setting.get('instanceName')

    for (const teamRole of ['member', 'admin', 'owner']) {
      await sails.models.user.updateOne({ id }).set({
        isGenesisUser: false,
        teamRole
      })
      for (const [method, path, body] of protectedRoutes) {
        const response = await browser.request[method](path, body)
        expect(response).toHaveStatus(403)
      }
    }
    expect(await sails.helpers.setting.get('instanceName')).toBe(originalName)

    await sails.models.team.destroyOne({
      id: world.current.teams.genesisTeam.id
    })
    await sails.models.user.destroyOne({ id })
    const deleted = await browser.request.post('/api/v1/bosun/eval', {
      code: '1+1'
    })
    expect(deleted).toHaveStatus(401)
  }
)

test(
  'instance founder can manage global settings independent of active team role',
  { world: 'configured-slipway' },
  async ({ sails, world, request, expect }) => {
    await sails.models.user
      .updateOne({ id: world.current.users.genesisUser.id })
      .set({ teamRole: 'member' })
    const browser = await withCsrfFromPage(
      request,
      '/settings/instance',
      'genesisUser'
    )
    expect(browser.page).toHaveStatus(200)
    const response = await browser.request.patch('/settings/instance', {
      instanceName: 'Authorized instance'
    })
    expect(response).toHaveStatus(409)
    expect(await sails.helpers.setting.get('instanceName')).toBe(
      'Authorized instance'
    )
  }
)
