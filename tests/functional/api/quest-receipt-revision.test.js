const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { test } = require('sounding')
const ledger = require('../../../api/lib/quest-run-ledger')
const { bearerRequest } = require('../../support/quest-resident-fixture')

test(
  'Quest persisted evidence revision updates inputs and logs without changing terminal facts',
  {
    transport: 'http',
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'quest-receipt-revision' } }
    }
  },
  async ({ sails, world }) => {
    const scope = {
      appId: world.current.apps.web.id,
      environmentId: world.current.environments.production.id
    }
    const now = Date.now()
    const event = {
      ...scope,
      runId: 'revision-functional-receipt',
      runtimeId: 'synthetic-runtime',
      deploymentId: 'synthetic-deployment',
      jobName: 'synthetic-report',
      state: 'completed',
      sequence: 2,
      requestedAt: now - 100,
      startedAt: now - 90,
      finishedAt: now - 10,
      exitCode: 0,
      inputs: {},
      result: { status: 'available', value: false },
      stdout: 'retained tail',
      stderr: '',
      logsTruncated: true
    }
    await ledger.admitReceipt(event, scope)
    await ledger.ingest(event, scope)
    // Deliberately put the row clock ahead of the supplied observation clock.
    const revision = now + 1000
    const before = await sails.models.questrun
      .updateOne({ runId: event.runId })
      .set({ updatedAt: revision })
    const enriched = await ledger.enrichResidentReceipt(
      {
        ...event,
        inputs: { count: 0, payload: 'p'.repeat(5000) },
        stdout: 'full process output with retained tail',
        logsTruncated: false
      },
      scope,
      { now }
    )
    assert.equal(enriched.updatedAt, revision + 1)
    assert.equal(enriched.inputs.count, 0)
    assert.equal(enriched.inputs.payload.length, 5000)
    assert.equal(enriched.logsTruncated, false)
    for (const field of [
      'state',
      'sequence',
      'resultStatus',
      'result',
      'requestedAt',
      'startedAt',
      'finishedAt',
      'exitCode',
      'inputHash'
    ])
      assert.deepEqual(enriched[field], before[field], field)
    const history = await ledger.listRuns(scope)
    const summary = history.runs.find((run) => run.runId === event.runId)
    assert.equal(summary.updatedAt, revision + 1)
    for (const field of ['inputs', 'result', 'stdout', 'stderr'])
      assert.equal(Object.hasOwn(summary, field), false)
    assert.equal(
      (await ledger.getRun(scope, event.runId)).updatedAt,
      revision + 1
    )
  }
)

test(
  'Quest summary-only receipt reads project bounded fields and enforce active team, environment, app and retention',
  {
    transport: 'http',
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'quest-summary-read' } }
    }
  },
  async (context) => {
    const { sails, world, request } = context
    const scope = {
      appId: world.current.apps.web.id,
      environmentId: world.current.environments.production.id
    }
    const admit = (extra = {}) =>
      ledger.admit({
        ...scope,
        runId: crypto.randomUUID(),
        runtimeId: 'synthetic-runtime',
        deploymentId: 'synthetic-deployment',
        jobName: 'synthetic-report',
        inputs: { payload: 'input-body-marker' },
        ...extra
      })
    const run = await admit()
    await ledger.ingest(
      {
        runId: run.runId,
        sequence: 1,
        state: 'completed',
        result: { status: 'available', value: 'result-body-marker' },
        stdout: 'stdout-body-marker',
        stderr: 'stderr-body-marker'
      },
      scope
    )
    const base = '/api/v1/projects/quest-summary-read/quest'
    const url = `${base}/runs/${run.runId}?summaryOnly=true`
    const client = await bearerRequest(context, world.current.users.genesisUser)
    const response = await client.get(url)
    assert.equal(response.status, 200)
    assert.equal(response.data.run.runId, run.runId)
    assert.equal(typeof response.data.run.updatedAt, 'number')
    for (const field of [
      'inputs',
      'result',
      'stdout',
      'stderr',
      'error',
      'inputHash',
      'requestKey'
    ])
      assert.equal(Object.hasOwn(response.data.run, field), false)
    assert.equal(JSON.stringify(response.data).includes('body-marker'), false)
    assert.equal((await request.get(url)).status, 401)
    assert.equal((await client.get(`${url}&appId=999999`)).status, 404)
    assert.equal(
      (await client.get(`${url}&environmentSlug=unrelated`)).status,
      404
    )

    const otherApp = await world.create('app').with({
      environment: scope.environmentId,
      name: 'Other receipt app',
      slug: 'other-receipt-app',
      isDefault: false
    })
    const otherRun = await admit({ appId: otherApp.id })
    const otherUrl = `${base}/runs/${otherRun.runId}?summaryOnly=true`
    assert.equal((await client.get(otherUrl)).status, 404)
    assert.equal(
      (await client.get(`${otherUrl}&appId=${otherApp.id}`)).status,
      200
    )
    const staging = await world.create('environment').with({
      project: world.current.projects.deploymentTarget.id
    })
    const stagingApp = await world
      .create('app')
      .trait('configured')
      .with({ environment: staging.id })
    const stagingRun = await admit({
      environmentId: staging.id,
      appId: stagingApp.id
    })
    assert.equal(
      (await client.get(`${base}/runs/${stagingRun.runId}?summaryOnly=true`))
        .status,
      404
    )

    const member = await world.create('user').with({
      team: world.current.teams.genesisTeam.id,
      teamRole: 'member',
      email: 'quest-summary-reader@example.com'
    })
    const foreignTeam = await world.create('team').with({
      owner: member.id,
      name: 'Foreign summary team'
    })
    for (const [team, expected] of [
      [member.team, 200],
      [foreignTeam.id, 404]
    ]) {
      const raw = crypto.randomBytes(24).toString('hex')
      await sails.models.clitoken.create({
        user: member.id,
        team,
        token: crypto.createHash('sha256').update(raw).digest('hex')
      })
      const tokenClient = request.withHeaders({
        authorization: `Bearer sl_${raw}`
      })
      assert.equal((await tokenClient.get(url)).status, expected)
    }
    await sails.models.questrun.updateOne({ runId: run.runId }).set({
      requestedAt: Date.now() - ledger.RETENTION_MS - 1000
    })
    assert.equal((await client.get(url)).status, 404)
  }
)
