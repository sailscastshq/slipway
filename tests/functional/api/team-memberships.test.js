const { test } = require('sounding')
const crypto = require('node:crypto')
const { withCsrfFromPage } = require('../../support/csrf-request')

test(
  'team creation preserves memberships, switches roles, and leaves CLI tokens scoped',
  { world: 'configured-slipway' },
  async ({ sails, world, request, expect }) => {
    const current = world.current,
      id = current.users.genesisUser.id,
      originalTeam = current.teams.genesisTeam.id
    const browser = await withCsrfFromPage(request, '/settings', 'genesisUser')
    const raw = crypto.randomBytes(32).toString('hex')
    await sails.models.clitoken.create({
      user: id,
      team: originalTeam,
      token: crypto.createHash('sha256').update(raw).digest('hex')
    })
    const tokenRequest = request.withHeaders({
      authorization: `Bearer sl_${raw}`
    })
    expect(
      await browser.request.post('/teams', { name: 'Second team' })
    ).toHaveStatus(409)
    const second = await sails.models.team.findOne({ name: 'Second team' })
    expect((await sails.models.user.findOne({ id })).team).toBe(originalTeam)
    expect(
      await sails.models.teammembership.count({ user: id, status: 'active' })
    ).toBe(2)
    const secondPage = await browser.request.get('/settings/team')
    expect(secondPage.data.props.team.id).toBe(second.id)
    expect(secondPage.data.props.currentUserRole).toBe('owner')
    // A token remains on its creation team despite the browser switch.
    const response = await tokenRequest.get('/api/v1/projects')
    expect(response).toHaveStatus(200)
    const principal = await require('../../../api/lib/authenticate-request')({
      headers: { authorization: `Bearer sl_${raw}` },
      session: {}
    })
    expect(principal.team).toBe(originalTeam)
    expect(
      await browser.request.post('/switch-team', { teamId: originalTeam })
    ).toHaveStatus(409)
    expect(
      (await browser.request.get('/settings/team')).data.props.team.id
    ).toBe(originalTeam)
  }
)

test(
  'removing a member retains their account and other team access; pending invitations require acceptance',
  { world: 'configured-slipway' },
  async ({ sails, world, request, expect }) => {
    const current = world.current,
      originalTeam = current.teams.genesisTeam.id
    const member = await world.create('user').with({
      team: originalTeam,
      teamRole: 'member',
      email: 'membership@example.com'
    })
    const ownTeam = await sails.models.team
      .create({ name: 'Member independent team', owner: member.id })
      .fetch()
    const token = await sails.models.clitoken
      .create({
        user: member.id,
        team: ownTeam.id,
        token: crypto.randomBytes(32).toString('hex')
      })
      .fetch()
    const browser = await withCsrfFromPage(
      request,
      '/settings/team',
      'genesisUser'
    )
    expect(
      await browser.request.delete(`/settings/team/${member.id}`)
    ).toHaveStatus(409)
    expect(Boolean(await sails.models.user.findOne({ id: member.id }))).toBe(
      true
    )
    expect(Boolean(await sails.models.clitoken.findOne({ id: token.id }))).toBe(
      true
    )
    expect(
      await sails.models.teammembership.count({
        user: member.id,
        team: originalTeam
      })
    ).toBe(0)
    expect(
      await sails.models.teammembership.count({
        user: member.id,
        team: ownTeam.id
      })
    ).toBe(1)
    expect(
      await browser.request.post('/settings/team/invite', {
        email: member.email,
        role: 'admin'
      })
    ).toHaveStatus(409)
    expect(
      (
        await sails.models.teammembership.findOne({
          user: member.id,
          team: originalTeam
        })
      ).status
    ).toBe('invited')
    const req = {
      headers: {},
      session: {
        userId: member.id,
        authVersion: member.authVersion || '',
        activeTeamId: originalTeam
      }
    }
    expect(
      (await require('../../../api/lib/authenticate-request')(req)).team
    ).toBe(ownTeam.id)
  }
)

test(
  'membership migration backfills legacy roles and tokens only once',
  { world: 'configured-slipway' },
  async ({ sails, world, expect }) => {
    const user = world.current.users.genesisUser,
      team = world.current.teams.genesisTeam
    await sails.models.setting.destroy({ key: 'teamMembershipMigration' })
    await sails.models.teammembership.destroy({ user: user.id })
    const token = await sails.models.clitoken
      .create({ user: user.id, token: crypto.randomBytes(32).toString('hex') })
      .fetch()
    await sails
      .getDatastore()
      .sendNativeQuery(
        `UPDATE cli_tokens SET team_id = NULL WHERE id = ${token.id}`
      )
    await sails.helpers.team.ensureSchema()
    expect(
      (
        await sails.models.teammembership.findOne({
          user: user.id,
          team: team.id
        })
      ).role
    ).toBe('owner')
    expect((await sails.models.clitoken.findOne({ id: token.id })).team).toBe(
      team.id
    )
    await sails.models.teammembership.destroy({ user: user.id, team: team.id })
    await sails.helpers.team.ensureSchema()
    expect(
      await sails.models.teammembership.count({ user: user.id, team: team.id })
    ).toBe(0)
  }
)
