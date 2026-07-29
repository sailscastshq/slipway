const { test } = require('sounding')

test(
  'owners can search Helm audit events while members cannot open the audit log',
  { world: 'configured-slipway' },
  async ({ sails, world, visit, request, expect }) => {
    const current = world.current
    const team = current.teams.genesisTeam
    const owner = current.users.genesisUser
    const member = await world.create('user').with({
      fullName: 'Audit Reader',
      email: 'audit-reader@example.com',
      team: team.id,
      teamRole: 'member'
    })

    await sails.models.auditlog.createEach([
      {
        action: 'helm.executed',
        resourceType: 'app',
        resourceId: '7',
        details: {
          sourceHash: 'a'.repeat(64),
          status: 'success',
          project: { slug: 'hagfish' },
          environment: { slug: 'production' },
          app: { slug: 'web' }
        },
        user: owner.id,
        team: team.id
      },
      {
        action: 'settings.updated',
        resourceType: 'setting',
        resourceId: 'instance',
        details: {},
        user: owner.id,
        team: team.id
      }
    ])

    const ownerPage = await visit.as('genesisUser')(
      '/settings/audit-log?group=helm&q=hagfish'
    )
    expect(ownerPage).toHaveStatus(200)
    expect(ownerPage).toBeInertiaPage('settings/audit-log')
    expect(ownerPage).toHaveInertiaPropCount('logs', 1)
    expect(ownerPage).toHaveInertiaProp('logs.0.action', 'helm.executed')
    expect(ownerPage).toHaveInertiaProp('filters.group', 'helm')
    expect(ownerPage).toHaveInertiaProp('filters.q', 'hagfish')
    expect(ownerPage).toHaveInertiaProp('helmAuditRetentionDays', 90)

    const memberPage = await visit.as(member)('/settings/audit-log')
    expect(memberPage).toHaveStatus(302)
    expect(memberPage).toRedirectTo('/settings')

    const memberApi = await request.as(member).get('/api/v1/audit-logs')
    expect(memberApi).toHaveStatus(403)
  }
)
