const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { test } = require('sounding')
const ledger = require('../../../api/lib/quest-run-ledger')

const worldConfig = {
  name: 'configured-slipway',
  context: { deploymentTarget: { slug: 'quest-ledger' } }
}
function scopeFor(world) {
  return {
    environmentId: world.current.environments.production.id,
    appId: world.current.apps.web.id
  }
}
function admission(scope, overrides = {}) {
  return {
    ...scope,
    runId: crypto.randomUUID(),
    deploymentId: 'deployment-a',
    runtimeId: 'runtime-a',
    jobName: 'synthetic-report',
    actor: 'Synthetic operator',
    trigger: 'manual',
    inputs: { limit: 5 },
    ...overrides
  }
}

test(
  'Quest ledger persists idempotent monotonic receipts, redacts data and never invents a run',
  {
    world: {
      ...worldConfig,
      context: { deploymentTarget: { slug: 'quest-ledger-ingest' } }
    }
  },
  async ({ world, sails }) => {
    const scope = scopeFor(world)
    const request = admission(scope, {
      requestId: 'repeat-request',
      inputs: { token: 'should-not-persist', limit: 5 }
    })
    const run = await ledger.admit(request)
    assert.equal(run.state, 'requested')
    assert.equal(run.resultStatus, 'unavailable')
    assert.equal(run.inputs.token, '<redacted>')
    assert.equal((await ledger.admit(request)).runId, run.runId)
    assert.equal(
      (await ledger.admit({ ...request, runId: crypto.randomUUID() })).runId,
      run.runId
    )
    await assert.rejects(
      ledger.admit({
        ...request,
        inputs: { token: 'changed-secret', limit: 5 }
      }),
      { code: 'QUEST_RUN_CONFLICT' }
    )
    assert.equal(
      await ledger.ingest(
        { runId: 'unknown-run', sequence: 1, state: 'running' },
        scope
      ),
      null
    )
    assert.equal(
      await ledger.ingest(
        { runId: run.runId, sequence: 1, state: 'running' },
        { ...scope, appId: 999 }
      ),
      null
    )
    await ledger.ingest(
      {
        runId: run.runId,
        sequence: 2,
        state: 'running',
        startedAt: Date.now()
      },
      scope
    )
    await ledger.ingest(
      { runId: run.runId, sequence: 1, state: 'failed' },
      scope
    )
    assert.equal((await ledger.getRun(scope, run.runId)).state, 'running')
    await ledger.markUnconfirmed(
      scope,
      run.runId,
      'transport lost TOKEN=do-not-store'
    )
    const unknown = await ledger.getRun(scope, run.runId)
    assert.equal(unknown.state, 'unconfirmed')
    assert.equal(unknown.sequence, 2)
    assert.equal(unknown.finishedAt, null)
    assert.equal(unknown.exitCode, null)
    assert.equal(unknown.error, 'transport lost TOKEN=<redacted>')
    await ledger.ingest(
      {
        runId: run.runId,
        sequence: 4,
        state: 'completed',
        finishedAt: Date.now(),
        exitCode: 0,
        result: {
          status: 'available',
          value: { total: 0, api_key: 'redact' },
          exit: 'invalid'
        },
        logs: { stdout: '💛'.repeat(20000), stderr: 'Bearer opaque-token' }
      },
      scope
    )
    await ledger.ingest(
      { runId: run.runId, sequence: 5, state: 'running' },
      scope
    )
    await ledger.ingest(
      {
        runId: run.runId,
        sequence: 6,
        state: 'failed',
        error: 'cannot rewrite terminal'
      },
      scope
    )
    const detail = await ledger.getRun(scope, run.runId)
    assert.equal(detail.state, 'completed')
    assert.equal(detail.result.value.total, 0)
    assert.equal(detail.result.exit, 'invalid')
    assert.equal(detail.exitCode, 0)
    assert.equal(
      (await ledger.markUnconfirmed(scope, run.runId, 'do not regress')).state,
      'completed'
    )
    assert.equal(detail.result.value.api_key, '<redacted>')
    assert.equal(Object.hasOwn(detail, 'stdout'), false)
    const logs = await ledger.getLogs(scope, run.runId)
    assert.ok(Buffer.byteLength(logs.stdout) <= 64 * 1024)
    assert.equal(logs.stderr, 'Bearer <redacted>')
    assert.equal(logs.available, true)
    assert.equal(logs.truncated, true)
    const concurrentRequest = admission(scope, {
      requestId: 'concurrent-repeat'
    })
    const admitted = await Promise.all([
      ledger.admit(concurrentRequest),
      ledger.admit(concurrentRequest)
    ])
    assert.equal(admitted[0].runId, admitted[1].runId)
    await Promise.all([
      ledger.ingest(
        {
          runId: admitted[0].runId,
          sequence: 1,
          state: 'running',
          startedAt: Date.now()
        },
        scope
      ),
      ledger.ingest(
        {
          runId: admitted[0].runId,
          sequence: 2,
          state: 'completed',
          exitCode: 0,
          result: { status: 'available', value: false }
        },
        scope
      )
    ])
    assert.equal(
      (await ledger.getRun(scope, admitted[0].runId)).state,
      'completed'
    )
    assert.equal((await ledger.getRun(scope, admitted[0].runId)).sequence, 2)
    assert.equal(await sails.models.questrun.count(), 2)
  }
)

test(
  'Quest history uses stable cursor pagination, compact summaries and separate lazy legacy events',
  {
    world: {
      ...worldConfig,
      context: { deploymentTarget: { slug: 'quest-ledger-pagination' } }
    }
  },
  async ({ world, sails }) => {
    const scope = scopeFor(world)
    const at = Date.now() - 100
    for (let i = 0; i < 30; i++)
      await ledger.admit(
        admission(scope, {
          requestedAt: at,
          runId: `run-${i}`,
          inputs: { payload: 'detail only' }
        })
      )
    const legacy = await sails.models.telemetrymetric
      .create({
        environment: String(scope.environmentId),
        recordedAt: at,
        name: 'quest.job.complete',
        value: 10,
        attributes: {
          jobName: 'synthetic-report',
          stdout: 'legacy detail',
          stderr: 'legacy warning',
          error: 'SECRET=hide'
        }
      })
      .fetch()
    await sails.models.telemetrymetric.createEach([
      {
        environment: String(scope.environmentId),
        recordedAt: at,
        name: 'quest.job.error',
        value: 20,
        attributes: { jobName: 'synthetic-report' }
      },
      {
        environment: String(scope.environmentId),
        recordedAt: at,
        name: 'http.request',
        value: 20,
        attributes: { jobName: 'not-a-job' }
      },
      {
        environment: String(scope.environmentId),
        recordedAt: at,
        name: 'quest.job.complete',
        value: 20,
        attributes: { jobName: 'correlated', runId: 'run-0' }
      },
      {
        environment: String(scope.environmentId),
        recordedAt: at,
        name: 'quest.job.complete',
        value: 20,
        attributes: { jobName: 'other-app', appId: 999 }
      }
    ])
    await sails.models.telemetrymetric.create({
      environment: String(scope.environmentId),
      recordedAt: at,
      name: 'quest.job.complete',
      value: 20,
      attributes: {
        jobName: 'correlated-envelope',
        questRun: { runId: 'run-1' }
      }
    })
    const first = await ledger.listRuns(scope)
    assert.equal(first.runs.length, 25)
    assert.ok(first.nextCursor)
    assert.equal(Object.hasOwn(first.runs[0], 'inputs'), false)
    assert.equal(Object.hasOwn(first.runs[0], 'result'), false)
    assert.equal(Object.hasOwn(first.runs[0], 'stdout'), false)
    // Even a backdated insertion must not enter a previously started snapshot.
    await ledger.admit(
      admission(scope, { requestedAt: at, runId: 'late-insertion' })
    )
    const second = await ledger.listRuns(scope, { cursor: first.nextCursor })
    assert.equal(second.runs.length, 5)
    assert.equal(second.legacyEvents.length, 2)
    assert.equal(second.nextCursor, null)
    assert.equal(
      new Set([...first.runs, ...second.runs].map((run) => run.runId)).size,
      30
    )
    assert.deepEqual(
      second.legacyEvents.map((event) => event.event),
      ['failed', 'completed']
    )
    assert.equal(Object.hasOwn(second.legacyEvents[0], 'stdout'), false)
    const detail = await ledger.getEvent(scope, legacy.id)
    assert.equal(detail.stdout, 'legacy detail')
    assert.equal(detail.stderr, 'legacy warning')
    assert.equal(detail.error, 'SECRET=<redacted>')
    assert.equal(
      await ledger.getEvent(
        { ...scope, appId: 999, includeLegacy: false },
        legacy.id
      ),
      null
    )
    await assert.rejects(
      ledger.listRuns({ ...scope, appId: 999 }, { cursor: first.nextCursor }),
      { code: 'QUEST_INVALID_CURSOR' }
    )
    await assert.rejects(ledger.listRuns(scope, { cursor: 'garbage' }), {
      code: 'QUEST_INVALID_CURSOR'
    })
    assert.equal((await ledger.listRuns(scope, { limit: 999 })).runs.length, 31)
  }
)

test(
  'Quest reads authorize session and token active teams, scope every receipt and retain only seven days',
  { world: worldConfig },
  async ({ world, sails, request, expect }) => {
    const scope = scopeFor(world)
    const run = await ledger.admit(admission(scope))
    const base = '/api/v1/projects/quest-ledger/quest'
    const browser = request.as('genesisUser')
    expect(await browser.get(`${base}/runs`)).toHaveStatus(200)
    expect(await browser.get(`${base}/runs/${run.runId}`)).toHaveJsonPath(
      'run.runId',
      run.runId
    )
    expect(await browser.get(`${base}/runs/${run.runId}/logs`)).toHaveJsonPath(
      'available',
      false
    )
    expect(await request.get(`${base}/runs`)).toHaveStatus(401)
    expect(
      await browser.get(`${base}/runs/${run.runId}?appId=999`)
    ).toHaveStatus(404)
    expect(
      await browser.get(
        `${base}/runs/${run.runId}?environmentSlug=does-not-exist`
      )
    ).toHaveStatus(404)
    const otherApp = await world.create('app').with({
      environment: scope.environmentId,
      name: 'Worker',
      slug: 'worker',
      isDefault: false
    })
    const otherRun = await ledger.admit(
      admission({ ...scope, appId: otherApp.id })
    )
    for (const suffix of [
      `/runs/${otherRun.runId}`,
      `/runs/${otherRun.runId}/logs`
    ])
      expect(await browser.get(`${base}${suffix}`)).toHaveStatus(404)
    expect(
      await browser.get(`${base}/runs/${otherRun.runId}?appId=${otherApp.id}`)
    ).toHaveStatus(200)
    const staging = await world
      .create('environment')
      .with({ project: world.current.projects.deploymentTarget.id })
    const stagingApp = await world
      .create('app')
      .trait('configured')
      .with({ environment: staging.id })
    const stagedRun = await ledger.admit(
      admission({ environmentId: staging.id, appId: stagingApp.id })
    )
    for (const suffix of [
      `/runs/${stagedRun.runId}`,
      `/runs/${stagedRun.runId}/logs`
    ])
      expect(await browser.get(`${base}${suffix}`)).toHaveStatus(404)
    const legacy = await sails.models.telemetrymetric
      .create({
        environment: String(scope.environmentId),
        recordedAt: Date.now(),
        name: 'quest.job.error',
        value: 3,
        attributes: { jobName: 'synthetic-report', stdout: 'lazy event log' }
      })
      .fetch()
    const stagedEvent = await sails.models.telemetrymetric
      .create({
        environment: String(staging.id),
        recordedAt: Date.now(),
        name: 'quest.job.error',
        value: 3,
        attributes: { jobName: 'synthetic-report' }
      })
      .fetch()
    const ordinaryMetric = await sails.models.telemetrymetric
      .create({
        environment: String(scope.environmentId),
        recordedAt: Date.now(),
        name: 'http.request',
        value: 3
      })
      .fetch()
    expect(await browser.get(`${base}/events/${legacy.id}`)).toHaveJsonPath(
      'event.stdout',
      'lazy event log'
    )
    for (const eventId of [
      stagedEvent.id,
      ordinaryMetric.id,
      '999999999999999999999999999'
    ])
      expect(await browser.get(`${base}/events/${eventId}`)).toHaveStatus(404)
    expect(
      await browser.get(`${base}/events/${legacy.id}?appId=${otherApp.id}`)
    ).toHaveStatus(404)
    const raw = crypto.randomBytes(24).toString('hex')
    await sails.models.clitoken.create({
      user: world.current.users.genesisUser.id,
      team: world.current.teams.genesisTeam.id,
      token: crypto.createHash('sha256').update(raw).digest('hex')
    })
    const token = request.withHeaders({ authorization: `Bearer sl_${raw}` })
    expect(await token.get(`${base}/runs/${run.runId}`)).toHaveStatus(200)
    // Ordinary read-only team members can inspect execution receipts.
    const member = await world.create('user').with({
      team: world.current.teams.genesisTeam.id,
      teamRole: 'member',
      email: 'quest-reader@example.com'
    })
    const readerRaw = crypto.randomBytes(24).toString('hex')
    await sails.models.clitoken.create({
      user: member.id,
      team: member.team,
      token: crypto.createHash('sha256').update(readerRaw).digest('hex')
    })
    expect(
      await request
        .withHeaders({ authorization: `Bearer sl_${readerRaw}` })
        .get(`${base}/runs/${run.runId}`)
    ).toHaveStatus(200)
    const otherTeam = await world
      .create('team')
      .with({ owner: member.id, name: 'Unrelated Quest team' })
    const foreignRaw = crypto.randomBytes(24).toString('hex')
    await sails.models.clitoken.create({
      user: member.id,
      team: otherTeam.id,
      token: crypto.createHash('sha256').update(foreignRaw).digest('hex')
    })
    const foreign = request.withHeaders({
      authorization: `Bearer sl_${foreignRaw}`
    })
    for (const suffix of [
      '/runs',
      `/runs/${run.runId}`,
      `/runs/${run.runId}/logs`,
      '/events/1'
    ])
      expect(await foreign.get(`${base}${suffix}`)).toHaveStatus(404)
    await sails.models.questrun
      .updateOne({ runId: run.runId })
      .set({ requestedAt: Date.now() - ledger.RETENTION_MS - 1 })
    assert.equal(await ledger.getRun(scope, run.runId), null)
    assert.equal(await ledger.getLogs(scope, run.runId), null)
    assert.equal((await ledger.listRuns(scope)).runs.length, 0)
    assert.equal((await ledger.prune()).deleted, 1)
  }
)
