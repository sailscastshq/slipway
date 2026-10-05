const assert = require('node:assert/strict')
const { test } = require('sounding')
const { withCsrfFromPage } = require('../../support/csrf-request')
const {
  worldFor,
  residentFixture
} = require('../../support/quest-resident-fixture')

test(
  'Quest app-scoped pages, controls and history preserve a non-default app and reject scope changes',
  { world: worldFor('quest-app-selection') },
  async (context) => {
    const { world, sails, request, visit, expect } = context
    const f = await residentFixture(context, 'quest-app-selection')
    const environment = world.current.environments.production
    try {
      await sails.models.app
        .updateOne({ id: f.app.id })
        .set({ isDefault: false })
      const primary = await world.create('app').with({
        environment: environment.id,
        slug: 'primary',
        name: 'Primary',
        isDefault: true,
        status: 'stopped'
      })
      const pageUrl = `/projects/quest-app-selection/environments/production/apps/${f.app.slug}/quest`
      const base = `/api/v1/projects/quest-app-selection/environments/production/apps/${f.app.slug}/quest`
      const selectedPage = await visit.as('genesisUser')(pageUrl)
      expect(selectedPage).toHaveInertiaProp('app.id', f.app.id)
      expect(selectedPage).toHaveInertiaProp('appSelectionExplicit', true)
      expect(selectedPage).toHaveInertiaProp('workspace.target.appId', f.app.id)
      expect(
        await visit.as('genesisUser')(
          pageUrl.replace('/environments/production', '')
        )
      ).toHaveInertiaProp('app.id', f.app.id)
      expect(await visit.as('genesisUser')(f.page)).toHaveInertiaProp(
        'app.id',
        primary.id
      )
      expect(
        await visit.as('genesisUser')(`${f.page}?appSlug=${f.app.slug}`)
      ).toHaveInertiaProp('app.id', f.app.id)
      const browser = await withCsrfFromPage(request, pageUrl, 'genesisUser')
      for (const operation of ['pause', 'resume']) {
        assert.equal(
          (
            await browser.request.post(
              `${pageUrl}/synthetic-report/${operation}`,
              { runtimeId: f.info.runtimeId }
            )
          ).status,
          200
        )
        assert.equal(f.calls.at(-1).target.id, f.app.id)
      }
      assert.equal(
        (
          await browser.request.post(
            `${base}/jobs/synthetic-report/run`,
            f.body()
          )
        ).status,
        202
      )
      assert.equal(f.starts.length, 1)
      const runs = await browser.request.get(`${base}/runs`)
      assert.equal(runs.status, 200)
      assert.equal(
        (
          await browser.request.get(
            `${base.replace('/environments/production', '')}/runs`
          )
        ).status,
        200
      )
      const runId = runs.data.runs[0].runId
      assert.equal(
        (await browser.request.get(`${base}/runs/${runId}`)).status,
        200
      )
      assert.equal(
        (await browser.request.get(`${base}/runs/${runId}/logs`)).status,
        200
      )
      assert.equal(
        (await browser.request.get(`${f.base}/runs/${runId}`)).status,
        404
      )
      for (const suffix of ['/runs', `/runs/${runId}`, `/runs/${runId}/logs`]) {
        assert.equal(
          (await browser.request.get(`${base}${suffix}?appId=${primary.id}`))
            .status,
          404
        )
        assert.equal(
          (await browser.request.get(`${base}${suffix}?appSlug=primary`))
            .status,
          404
        )
      }
      const staging = await world.create('environment').with({
        project: world.current.projects.deploymentTarget.id,
        slug: 'staging'
      })
      const foreign = await world.create('app').with({
        environment: staging.id,
        slug: 'foreign-worker',
        isDefault: false
      })
      const before = f.calls.length
      for (const slug of [foreign.slug, 'missing', '..']) {
        const invalidBase = base.replace(
          `/apps/${f.app.slug}/`,
          `/apps/${slug}/`
        )
        assert.equal(
          (await browser.request.get(`${invalidBase}/runs`)).status,
          404
        )
        assert.equal(
          (
            await browser.request.post(
              `${invalidBase}/jobs/synthetic-report/run`,
              f.body()
            )
          ).status,
          404
        )
      }
      assert.equal(f.calls.length, before)
      assert.equal((await request.get(`${base}/runs`)).status, 401)
      const user = world.current.users.genesisUser
      const team = world.current.teams.genesisTeam
      const owner = await world.create('user').with({ fullName: 'Other owner' })
      await sails.models.team
        .updateOne({ id: team.id })
        .set({ owner: owner.id })
      await sails.models.teammembership
        .update({ user: user.id, team: team.id })
        .set({ role: 'member' })
      assert.equal((await browser.request.get(`${base}/runs`)).status, 200)
      assert.equal(
        (
          await browser.request.post(
            `${base}/jobs/synthetic-report/run`,
            f.body()
          )
        ).status,
        403
      )
      assert.equal(
        (
          await browser.request.post(`${pageUrl}/synthetic-report/pause`, {
            runtimeId: f.info.runtimeId
          })
        ).status,
        403
      )
      assert.equal(f.starts.length, 1)
      const otherTeam = await world
        .create('team')
        .with({ name: 'Foreign team', owner: owner.id })
      const otherProject = await world.create('project').with({
        name: 'Foreign project',
        slug: 'foreign-quest-project',
        team: otherTeam.id,
        createdBy: owner.id
      })
      assert.equal(
        (
          await browser.request.get(
            `/api/v1/projects/${otherProject.slug}/apps/${f.app.slug}/quest/runs`
          )
        ).status,
        404
      )
    } finally {
      f.restore()
    }
  }
)
