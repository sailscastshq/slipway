const assert = require('node:assert/strict')
const { test } = require('sounding')
const { withCsrfFromPage } = require('../../support/csrf-request')
const workspace = require('../../../api/lib/quest-workspace')
const {
  worldFor,
  residentFixture
} = require('../../support/quest-resident-fixture')

test(
  'Quest legacy, stopped, stale and unsupported resident targets fail closed without admitting work',
  { world: worldFor('quest-resident-gates') },
  async (context) => {
    const f = await residentFixture(context, 'quest-resident-gates')
    const { sails, request, world, visit } = context
    try {
      const browser = await withCsrfFromPage(request, f.page, 'genesisUser')
      // Initial page/history is deliberately lazy; opening Quest runs nothing.
      assert.equal(f.calls.length, 0)
      assert.equal(f.starts.length, 0)
      const url = `${f.base}/jobs/synthetic-report/run`
      for (const productionConfirmed of [undefined, false]) {
        const before = f.calls.length
        assert.equal(
          (await browser.request.post(url, f.body({ productionConfirmed })))
            .status,
          400
        )
        assert.equal(f.calls.length, before)
      }
      for (const extra of [
        { runtimeId: 'stale-runtime' },
        { metadataVersion: 'stale-inputs' }
      ])
        assert.equal(
          (await browser.request.post(url, f.body(extra))).status,
          409
        )
      assert.equal(f.starts.length, 0)
      await sails.models.app
        .updateOne({ id: f.app.id })
        .set({ status: 'stopped' })
      workspace.invalidate(f.app)
      const beforeStopped = f.calls.length
      assert.equal((await browser.request.post(url, f.body())).status, 409)
      assert.equal(f.calls.length, beforeStopped)
      await sails.models.app
        .updateOne({ id: f.app.id })
        .set({ status: 'running' })
      f.setContract(0)
      assert.equal((await browser.request.post(url, f.body())).status, 409)
      assert.equal(
        f.calls.filter(({ command }) => command === 'invoke').length,
        0
      )
      assert.equal(f.starts.length, 0)
      assert.equal(await sails.models.questrun.count(), 0)
      const page = await visit.as('genesisUser')(f.page)
      context.expect(page).toHaveInertiaProp('workspace.mode', 'legacy')
      context
        .expect(page)
        .toHaveInertiaProp('workspace.capabilities.invoke', false)
      assert.equal(
        world.current.environments.production.id,
        f.calls[0].target.environment
      )
    } finally {
      f.restore()
    }
  }
)

test(
  'Quest session writes require CSRF and current active-team owner/admin authority before reaching the resident transport',
  { world: worldFor('quest-resident-permissions') },
  async (context) => {
    const f = await residentFixture(context, 'quest-resident-permissions')
    const { sails, world, request } = context
    const user = world.current.users.genesisUser
    const team = world.current.teams.genesisTeam
    try {
      const browser = await withCsrfFromPage(request, f.page, 'genesisUser')
      const url = `${f.base}/jobs/synthetic-report/run`
      assert.equal(
        (await request.as('genesisUser').post(url, f.body())).status,
        403
      )
      assert.equal(f.calls.length, 0)
      const owner = await world
        .create('user')
        .with({ fullName: 'Current owner' })
      await sails.models.team
        .updateOne({ id: team.id })
        .set({ owner: owner.id })
      await sails.models.teammembership
        .update({ user: user.id, team: team.id })
        .set({ role: 'member' })
      for (const [target, body] of [
        [url, f.body({ teamRole: 'owner' })],
        [`${f.page}/synthetic-report/pause`, { runtimeId: f.info.runtimeId }],
        [`${f.page}/synthetic-report/resume`, { runtimeId: f.info.runtimeId }]
      ])
        assert.equal((await browser.request.post(target, body)).status, 403)
      assert.equal(f.calls.length, 0)
      for (const role of ['owner', 'admin']) {
        await sails.models.teammembership
          .update({ user: user.id, team: team.id })
          .set({ role })
        assert.equal((await browser.request.post(url, f.body())).status, 202)
      }
      assert.equal(f.starts.length, 2)
      const foreignTeam = await world
        .create('team')
        .with({ name: 'Other active team', owner: user.id })
      await world.create('project').with({
        name: 'Other project',
        slug: 'quest-other-team',
        team: foreignTeam.id,
        createdBy: user.id
      })
      const before = f.calls.length
      const foreign = await browser.request.post(
        '/api/v1/projects/quest-other-team/quest/jobs/synthetic-report/run',
        f.body()
      )
      assert.ok([403, 404].includes(foreign.status))
      assert.equal(f.calls.length, before)
      await sails.models.teammembership
        .update({ user: user.id, team: team.id })
        .set({ status: 'invited' })
      const inactive = await browser.request.post(url, f.body())
      assert.ok([403, 404].includes(inactive.status))
      assert.equal(f.calls.length, before)
    } finally {
      f.restore()
    }
  }
)
