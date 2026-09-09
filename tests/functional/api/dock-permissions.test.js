const { test } = require('sounding')
const { withCsrfFromPage } = require('../../support/csrf-request')

test(
  'Dock database execution requires a current owner/admin role in the target team',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'dock-permissions' } }
    }
  },
  async ({ sails, world, request, expect }) => {
    const id = world.current.users.genesisUser.id
    const browser = await withCsrfFromPage(
      request,
      '/projects/dock-permissions',
      'genesisUser'
    )
    const original = sails.helpers.dock.getDatabaseService
    const execute = sails.helpers.dock.executeSql
    let resolutions = 0
    const resolve = async () => {
      resolutions++
      return { service: { id: 'fixture', type: 'postgresql' } }
    }
    resolve.with = resolve
    sails.helpers.dock.getDatabaseService = resolve
    const run = async () => ({ success: true })
    run.with = run
    sails.helpers.dock.executeSql = run
    try {
      const owner = await world
        .create('user')
        .with({ fullName: 'Current team owner' })
      await sails.models.team
        .updateOne({ id: world.current.teams.genesisTeam.id })
        .set({ owner: owner.id })
      await sails.models.teammembership
        .update({ user: id, team: world.current.teams.genesisTeam.id })
        .set({ role: 'member' })
      for (const prefix of [
        '/api/v1/projects/dock-permissions/dock',
        '/api/v1/projects/dock-permissions/environments/production/dock'
      ]) {
        for (const [suffix, body] of [
          ['/migrate', { statements: ['SELECT 1'], dryRun: true }],
          ['/sql', { query: 'SELECT 1' }],
          ['/import', { sql: 'SELECT 1' }]
        ]) {
          expect(
            await browser.request.post(prefix + suffix, {
              ...body,
              teamRole: 'owner'
            })
          ).toHaveStatus(403)
        }
      }
      expect(resolutions).toBe(0)
      for (const teamRole of ['owner', 'admin']) {
        await sails.models.teammembership
          .update({ user: id, team: world.current.teams.genesisTeam.id })
          .set({ role: teamRole })
        expect(
          await browser.request.post(
            '/api/v1/projects/dock-permissions/dock/migrate',
            { statements: ['SELECT 1'], dryRun: true }
          )
        ).toHaveStatus(400)
        expect(
          await browser.request.post(
            '/api/v1/projects/dock-permissions/dock/sql',
            { query: 'SELECT 1' }
          )
        ).toHaveStatus(200)
      }
      const before = resolutions
      const otherTeam = await world
        .create('team')
        .with({ name: 'Other team', owner: id })
      await world.create('project').with({
        name: 'Other project',
        slug: 'other-dock-project',
        team: otherTeam.id,
        createdBy: id
      })
      expect(
        await browser.request.post(
          '/api/v1/projects/other-dock-project/dock/migrate',
          { statements: ['SELECT 1'], dryRun: true }
        )
      ).toHaveStatus(403)
      expect(resolutions).toBe(before)
    } finally {
      sails.helpers.dock.getDatabaseService = original
      sails.helpers.dock.executeSql = execute
    }
  }
)
