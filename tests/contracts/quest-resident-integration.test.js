const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { test } = require('sounding')
const runtime = require('../../api/lib/quest-runtime-client')
const workspace = require('../../api/lib/quest-workspace')
// Import only world/auth helpers, never the synthetic residentFixture adapter.
const { worldFor, bearerRequest } = require('../support/quest-resident-fixture')
const {
  createFixture,
  sleep
} = require('../fixtures/quest-resident/docker.cjs')
const { realBrowserFlow } = require('../fixtures/quest-resident/browser.cjs')
const { recoveryTrials } = require('../fixtures/quest-resident/recovery.cjs')
const { useDockerBinary } = require('../fixtures/quest-resident/dashboard.cjs')

const slug = 'quest-real-resident'
const terminal = (run) => ['completed', 'failed', 'skipped'].includes(run.state)
const startsFor = (events, name) =>
  events.filter((event) => event.kind === 'quest:start' && event.name === name)
const businessFor = (events, name) =>
  events.filter(
    (event) => event.kind === 'business:start' && event.name === name
  )

test(
  'pinned upstream Quest executes a worker through real Sails, Docker, HTTP, browser and persisted receipts',
  { browser: true, transport: 'http', world: worldFor(slug) },
  async (context) => {
    const { sails, world } = context
    const current = world.current,
      environment = current.environments.production
    const deployment = await world.create('deployment').with({
      environment: environment.id,
      app: current.apps.web.id,
      status: 'running'
    })
    let app = await sails.models.app
      .updateOne({ id: current.apps.web.id })
      .set({ status: 'running', currentDeployment: deployment.id })
    let restoreDockerBinary
    let fixture
    try {
      fixture = await createFixture(app)
      restoreDockerBinary = useDockerBinary(sails.config, fixture.docker)
      app = await sails.models.app
        .updateOne({ id: app.id })
        .set({ containerName: fixture.name })
      environment.features = {
        'sails-quest': { scripts: [{ name: 'rebuild-search-index' }] }
      }
      await sails.models.environment
        .updateOne({ id: environment.id })
        .set({ features: environment.features })
      const base = `/api/v1/projects/${slug}/quest`
      const view = { app, environment, user: current.users.genesisUser }
      const call = (command, values = {}) =>
        runtime.request(app, command, values, { binary: fixture.docker })
      const snapshot = () => call('snapshot')
      const refresh = () => workspace.snapshot(view, { fresh: true })
      const evidence = () => fixture.inspect('evidence')
      const waitForRun = async (runId) =>
        (
          await fixture.waitFor(
            () => call('run', { runId }),
            (value) => terminal(value.run),
            `terminal upstream run ${runId}`
          )
        ).run
      const bodyFor = async (name, jobInputs = {}, overrides = {}) => {
        const live = await snapshot(),
          job = live.jobs.find((item) => item.name === name)
        assert.ok(job, `Real source must register ${name}`)
        return {
          runtimeId: live.runtimeId,
          metadataVersion: job.metadataVersion,
          requestId: randomUUID(),
          productionConfirmed: true,
          jobInputs,
          ...overrides
        }
      }
      let streamHeaders
      const client = await bearerRequest(
        {
          ...context,
          request: {
            withHeaders(headers) {
              streamHeaders = headers
              return context.request.withHeaders(headers)
            }
          }
        },
        current.users.genesisUser
      )
      const invoke = async (name, inputs = {}, overrides = {}) => {
        const body = await bodyFor(name, inputs, overrides)
        const response = await client.post(`${base}/jobs/${name}/run`, body)
        assert.equal(response.status, 202, JSON.stringify(response.data))
        return { body, run: response.data.run }
      }
      const readPersisted = async (runId, wanted) =>
        fixture.waitFor(
          async () => {
            await refresh()
            const response = await client.get(`${base}/runs/${runId}`)
            assert.equal(response.status, 200)
            return response.data.run
          },
          (run) => !wanted || run.state === wanted,
          `persisted ${wanted || ''} receipt ${runId}`
        )
      const control = async (name, command) => {
        const live = await snapshot()
        const response = await client.post(
          `/projects/${slug}/quest/${name}/${command}`,
          { runtimeId: live.runtimeId }
        )
        assert.equal(response.status, 200, JSON.stringify(response.data))
        return (await snapshot()).jobs.find((job) => job.name === name)
      }

      // This is the complete installed hook lifecycle, with real Linux identity.
      assert.equal(fixture.ready.http, false)
      for (const name of [
        'childSchedulerSuppression',
        'triggerProvenance',
        'terminalExitCode',
        'terminalSignal',
        'scheduleDiagnostics'
      ])
        assert.equal(fixture.ready.capabilities[name], true)
      const ownership = await fixture.inspect('ownership')
      assert.equal(ownership.tcpListeners, 0)
      assert.equal(ownership.live.length, 1)
      const owned = ownership.live[0]
      assert.equal(owned.identity.pid, fixture.ready.pid)
      assert.equal(owned.directoryMode, 0o700)
      assert.equal(owned.fileMode, 0o600)
      assert.equal(owned.socketMode, 0o600)
      assert.ok(owned.socket)
      for (const key of ['directoryUid', 'fileUid', 'socketUid'])
        assert.equal(owned[key], owned.uid)
      await assert.rejects(
        runtime.request(
          { ...app, currentDeployment: Number(deployment.id) + 99999 },
          'snapshot',
          {},
          { binary: fixture.docker }
        ),
        /unavailable|unconfirmed/i
      )

      const initial = await snapshot()
      const helperReferences = (await evidence()).filter(
        (event) => event.kind === 'helper:reference'
      )
      assert.equal(helperReferences.length, 1)
      const helperReference = helperReferences[0]
      assert.equal(helperReference.pid, fixture.ready.pid)
      assert.equal(helperReference.runtimeId, initial.runtimeId)
      assert.equal(helperReference.helper, 'buildIndexReport')
      assert.equal(initial.capabilities.invoke, true)
      assert.equal(initial.capabilities.results, true)
      assert.equal(initial.capabilities.cancel, false)
      assert.ok(
        initial.jobs.every((job) => job.inputMetadataAvailable === true)
      )
      const alias = initial.jobs.find((job) => job.name === 'index-from-config')
      assert.equal(alias.script, 'rebuild-search-index')
      assert.equal(alias.scheduleType, 'interval')
      assert.equal(alias.schedule, 600000)
      assert.equal(alias.scheduled, true)
      assert.ok(alias.nextRunAt > Date.now())
      assert.deepEqual(alias.scheduledInputs.values, {
        collection: 'articles',
        batchSize: 100,
        dryRun: true
      })
      assert.equal(alias.scheduledInputs.fields.collection.source, 'job_input')
      assert.equal(
        alias.scheduledInputs.fields.batchSize.source,
        'script_input'
      )
      const schema = initial.jobs.find(
        (job) => job.name === 'rebuild-search-index'
      ).inputs
      assert.deepEqual(
        schema.find((field) => field.name === 'collection').isIn,
        ['articles', 'products']
      )
      assert.equal(schema.find((field) => field.name === 'batchSize').max, 1000)
      const executionEvidence = (items) =>
        items.filter((item) =>
          ['sails-load', 'quest:start', 'business:start'].includes(item.kind)
        )
      const beforeReads = executionEvidence(await evidence())
      for (let i = 0; i < 5; i++) {
        const live = await snapshot()
        assert.equal(live.runtimeId, initial.runtimeId)
        assert.equal(live.jobs.length, initial.jobs.length)
        assert.equal(
          live.jobs.find((job) => job.name === alias.name).nextRunAt,
          alias.nextRunAt
        )
      }
      assert.deepEqual(
        executionEvidence(await evidence()),
        beforeReads,
        'Inspection does not lift Sails, add a job or start work'
      )
      const invalidSchedule = initial.jobs.find(
        (job) => job.name === 'invalid-schedule'
      )
      assert.equal(invalidSchedule.scheduled, false)
      assert.equal(invalidSchedule.nextRunAt, null)
      assert.equal(invalidSchedule.scheduleState.validation, 'invalid')
      assert.equal(
        invalidSchedule.scheduleState.validationErrors[0].code,
        'E_SCHEDULE_CRON'
      )
      const expiredSchedule = initial.jobs.find(
        (job) => job.name === 'expired-schedule'
      )
      assert.equal(expiredSchedule.scheduled, false)
      assert.equal(expiredSchedule.nextRunAt, null)
      assert.equal(expiredSchedule.scheduleState.validation, 'valid')
      assert.equal(expiredSchedule.scheduleState.reason, 'no_future_run')
      const stoppedSchedule = initial.jobs.find(
        (job) => job.name === 'stopped-schedule'
      )
      assert.equal(stoppedSchedule.scheduleState.registration, 'stopped')
      assert.equal(stoppedSchedule.scheduleState.validation, 'valid')
      assert.equal(stoppedSchedule.nextRunAt, null)
      const timezoneCron = initial.jobs.find(
        (job) => job.name === 'timezone-cron'
      )
      assert.equal(timezoneCron.timezone, 'America/New_York')
      assert.equal(timezoneCron.scheduleState.registration, 'registered')
      assert.equal(timezoneCron.scheduleState.validation, 'valid')
      assert.equal(timezoneCron.scheduleState.restart.timing, 'wall_clock')
      assert.ok(timezoneCron.nextRunAt > Date.now())
      assert.equal(
        initial.jobs.find((job) => job.name === 'timezone-default').timezone,
        null,
        'An explicit local-default tz must not fall back to unrecognized cronOptions.timezone'
      )
      assert.equal(
        alias.scheduleState.restart.timing,
        'relative_to_registration'
      )
      assert.equal(alias.scheduleState.restart.persistence, 'memory_only')
      const manualOnly = initial.jobs.find((job) => job.name === 'result-value')
      assert.equal(manualOnly.scheduleState.validation, 'not_checked')
      assert.equal(manualOnly.scheduleState.reason, 'no_schedule')
      const allowedManual = await invoke('invalid-schedule', {
        value: 'manual despite invalid schedule'
      })
      assert.equal(
        (await waitForRun(allowedManual.run.runId)).result.value,
        'manual despite invalid schedule'
      )
      assert.equal(
        (await snapshot()).jobs.find((job) => job.name === 'invalid-schedule')
          .scheduleState.validation,
        'invalid'
      )
      await fixture.inspect('consume')
      const consumedLive = await fixture.waitFor(
        snapshot,
        (live) =>
          live.jobs.find((job) => job.name === 'consumed-once')?.scheduleState
            .registration === 'consumed',
        'real one-shot consumption'
      )
      const consumedJob = consumedLive.jobs.find(
        (job) => job.name === 'consumed-once'
      )
      assert.equal(consumedJob.scheduleState.validation, 'valid')
      assert.equal(consumedJob.scheduleState.restart.oneShot, true)
      assert.equal(consumedJob.scheduleState.restart.missedRuns, 'not_replayed')
      assert.equal(consumedJob.scheduled, false)
      assert.equal(consumedJob.nextRunAt, null)
      const consumedRun = consumedLive.runs.find(
        (run) => run.jobName === 'consumed-once'
      )
      assert.ok(consumedRun)
      assert.equal(consumedRun.trigger, 'scheduled')
      assert.equal(
        (await waitForRun(consumedRun.runId)).result.value,
        'one-shot'
      )

      const inputs = { collection: 'articles', batchSize: 200, dryRun: true }
      for (const jobInputs of [
        false,
        {},
        { collection: 'unknown' },
        { ...inputs, batchSize: 1001 },
        { ...inputs, dryRun: 'false' },
        { ...inputs, unknown: true }
      ])
        assert.equal(
          (
            await client.post(
              `${base}/jobs/rebuild-search-index/run`,
              await bodyFor('rebuild-search-index', jobInputs)
            )
          ).status,
          400
        )
      assert.equal(
        (
          await client.post(
            `${base}/jobs/rebuild-search-index/run`,
            await bodyFor('rebuild-search-index', inputs, {
              productionConfirmed: false
            })
          )
        ).status,
        400
      )
      assert.equal(
        startsFor(await evidence(), 'rebuild-search-index').length,
        0
      )
      const body = await bodyFor('rebuild-search-index', inputs)
      const accepted = await Promise.all([
        client.post(`${base}/jobs/rebuild-search-index/run`, body),
        client.post(`${base}/jobs/rebuild-search-index/run`, body)
      ])
      assert.ok(
        accepted.every((response) => response.status === 202),
        JSON.stringify(accepted.map((response) => response.data))
      )
      const runId = accepted[0].data.run.runId
      assert.equal(accepted[1].data.run.runId, runId)
      const completed = await waitForRun(runId)
      assert.equal(completed.state, 'completed')
      assert.equal(completed.exitCode, 0)
      assert.equal(completed.trigger, 'manual')
      assert.equal(completed.result.status, 'available')
      assert.deepEqual(completed.result.value, {
        indexed: 240,
        skipped: 3,
        dryRun: true
      })
      assert.deepEqual(helperReference.inputs, inputs)
      assert.deepEqual(
        completed.result.value,
        helperReference.result,
        'The separate Quest child receipt equals the direct resident Sails helper result'
      )
      assert.match(completed.stderr, /fixture-warning/)
      assert.match(completed.stdout, /999999/)
      const events = await evidence(),
        starts = startsFor(events, 'rebuild-search-index'),
        business = businessFor(events, 'rebuild-search-index')
      assert.equal(starts.length, 1)
      assert.equal(business.length, 1)
      assert.equal(starts[0].runId, runId)
      assert.equal(starts[0].trigger, 'manual')
      assert.equal(
        starts[0].childrenAtEvent.includes(business[0].pid),
        false,
        'Canonical start precedes its actual child spawn'
      )
      assert.deepEqual(business[0].inputs, inputs)
      assert.equal(
        events.find(
          (event) => event.kind === 'quest:complete' && event.runId === runId
        ).exitCode,
        0
      )
      assert.equal(
        (
          await client.post(`${base}/jobs/rebuild-search-index/run`, {
            ...body,
            jobInputs: { ...inputs, batchSize: 201 }
          })
        ).status,
        400
      )
      await readPersisted(runId, 'completed')
      assert.equal(await sails.models.questrun.count({ runId }), 1)
      const logs = await client.get(`${base}/runs/${runId}/logs`)
      assert.equal(logs.status, 200)
      assert.match(logs.data.stderr, /fixture-warning/)
      assert.equal(
        (await client.get(`${base}/runs?job=rebuild-search-index`)).data.runs[0]
          .runId,
        runId
      )

      const browserRunId = await realBrowserFlow(context, {
        slug,
        base,
        runtimeId: initial.runtimeId
      })
      assert.equal(
        (await client.get(`${base}/runs/${browserRunId}`)).data.run.state,
        'completed'
      )
      assert.equal(
        startsFor(await evidence(), 'rebuild-search-index').length,
        2,
        'Reopen never replays the real job'
      )

      for (const values of [
        {
          count: 0,
          enabled: false,
          label: '001',
          payload: { zero: 0, flag: false, nothing: null, rows: [] }
        },
        { count: 0, enabled: false, label: '', payload: null },
        { label: null }
      ]) {
        const typed = await invoke('typed-report', values)
        const result = await waitForRun(typed.run.runId)
        assert.equal(result.state, 'completed', result.error)
        assert.deepEqual(result.result.value, {
          count: 7,
          enabled: true,
          label: 'default',
          payload: { omitted: true },
          ...values
        })
      }
      for (const value of [0, false, null, '001', '', []]) {
        const scalar = await invoke('result-value', { value })
        const result = (await waitForRun(scalar.run.runId)).result
        assert.equal(result.status, 'available')
        assert.deepEqual(result.value, value)
      }
      const noReturn = await invoke('result-value')
      assert.equal(
        (await waitForRun(noReturn.run.runId)).result.status,
        'undefined'
      )
      const defaults = await invoke('index-from-config')
      assert.deepEqual(
        (await waitForRun(defaults.run.runId)).inputs,
        alias.scheduledInputs.values
      )
      const override = await invoke('index-from-config', {
        batchSize: 200,
        dryRun: false
      })
      assert.deepEqual((await waitForRun(override.run.runId)).inputs, {
        collection: 'articles',
        batchSize: 200,
        dryRun: false
      })
      assert.deepEqual(
        (await snapshot()).jobs.find((job) => job.name === alias.name)
          .scheduledInputs,
        alias.scheduledInputs
      )

      const named = await invoke('named-exit'),
        namedResult = await waitForRun(named.run.runId)
      assert.equal(namedResult.state, 'completed')
      assert.equal(namedResult.exitCode, 0)
      assert.equal(namedResult.result.exit, 'nothingToDo')
      assert.deepEqual(namedResult.result.value, { processed: 0, pending: 5 })
      assert.equal(
        (await readPersisted(named.run.runId, 'completed')).result.exit,
        'nothingToDo'
      )
      const thrown = await invoke('throwing-job'),
        failure = await waitForRun(thrown.run.runId)
      assert.equal(failure.state, 'failed')
      assert.equal(failure.exitCode, 1)
      assert.match(
        `${failure.error || ''}\n${failure.stderr || ''}`,
        /Synthetic business failure/
      )
      const signaled = await invoke('self-signal')
      const signaledResult = await waitForRun(signaled.run.runId)
      assert.equal(signaledResult.state, 'failed')
      assert.equal(signaledResult.exitCode, null)
      assert.equal(signaledResult.signal, 'SIGTERM')
      assert.equal(
        (await evidence()).find(
          (event) =>
            event.kind === 'quest:error' && event.runId === signaled.run.runId
        ).signal,
        'SIGTERM'
      )
      const signaledReceipt = await readPersisted(signaled.run.runId, 'failed')
      assert.equal(signaledReceipt.signal, 'SIGTERM')
      assert.equal(signaledReceipt.exitCode, null)

      const invalidBody = await bodyFor('validated-job', { even: 3 })
      assert.equal(
        (await client.post(`${base}/jobs/validated-job/run`, invalidBody))
          .status,
        400
      )
      const rejected = (await evidence()).find(
        (event) =>
          event.kind === 'quest:error' && event.name === 'validated-job'
      )
      assert.equal(rejected.admission, 'rejected_before_start')
      assert.equal(rejected.phase, 'validation')
      assert.equal(rejected.trigger, 'manual')
      assert.equal(Object.hasOwn(rejected, 'exitCode'), false)
      assert.equal(startsFor(await evidence(), 'validated-job').length, 0)
      assert.equal(businessFor(await evidence(), 'validated-job').length, 0)
      await refresh()
      assert.equal(
        await sails.models.questrun.count({ jobName: 'validated-job' }),
        0
      )
      assert.equal(
        (await client.post(`${base}/jobs/validated-job/run`, invalidBody))
          .status,
        400
      )
      const validated = await invoke('validated-job', { even: 4 })
      assert.deepEqual((await waitForRun(validated.run.runId)).result.value, {
        validated: 4
      })

      const privateValue = 'SYNTHETIC_PRIVATE_VALUE_6841'
      const protectedRun = await invoke('protected-report', {
        accessCode: privateValue
      })
      const protectedResult = await waitForRun(protectedRun.run.runId)
      assert.equal(protectedResult.state, 'completed')
      assert.equal(protectedResult.result.value.publicCount, 12)
      assert.equal(
        JSON.stringify(protectedResult).includes(privateValue),
        false
      )
      assert.equal(
        JSON.stringify(
          await readPersisted(protectedRun.run.runId, 'completed')
        ).includes(privateValue),
        false
      )
      assert.equal(
        JSON.stringify(
          (await client.get(`${base}/runs/${protectedRun.run.runId}/logs`)).data
        ).includes(privateValue),
        false
      )
      assert.equal(
        JSON.stringify(
          await sails.models.auditlog.find({ action: 'quest.run.admitted' })
        ).includes(privateValue),
        false
      )

      await control('slow-overlap', 'resume')
      const scheduledLive = await fixture.waitFor(
        snapshot,
        (live) =>
          live.runs.some(
            (run) => run.jobName === 'slow-overlap' && run.state === 'running'
          ),
        'real scheduled child'
      )
      const scheduled = scheduledLive.runs.find(
        (run) => run.jobName === 'slow-overlap' && run.state === 'running'
      )
      assert.equal(scheduled.trigger, 'scheduled')
      assert.equal(
        (
          await client.post(
            `${base}/jobs/slow-overlap/run`,
            await bodyFor('slow-overlap')
          )
        ).status,
        409
      )
      await fixture.waitFor(
        evidence,
        (items) =>
          items.some(
            (event) =>
              event.kind === 'quest:skip' &&
              event.name === 'slow-overlap' &&
              event.reason === 'already_running'
          ),
        'actual timer overlap guard'
      )
      assert.equal(startsFor(await evidence(), 'slow-overlap').length, 1)
      assert.equal((await control('slow-overlap', 'pause')).paused, true)
      assert.equal(
        (await call('run', { runId: scheduled.runId })).run.state,
        'running'
      )
      assert.equal(
        (
          await client.post(
            `${base}/jobs/slow-overlap/run`,
            await bodyFor('slow-overlap')
          )
        ).status,
        409
      )
      const scheduledResult = await waitForRun(scheduled.runId)
      assert.equal(scheduledResult.state, 'completed')
      assert.equal(scheduledResult.result.value.finished, true)
      assert.deepEqual(scheduledResult.inputs, {
        label: 'scheduled',
        delayMs: 7000
      })
      assert.equal(
        startsFor(await evidence(), 'slow-overlap')[0].trigger,
        'scheduled'
      )
      await readPersisted(scheduled.runId, 'completed')
      const pausedCount = startsFor(await evidence(), 'slow-overlap').length
      await sleep(4500)
      assert.equal(
        startsFor(await evidence(), 'slow-overlap').length,
        pausedCount
      )

      const disconnected = await invoke('slow-job', {
        label: 'disconnected-reader',
        delayMs: 4500
      })
      const abort = new AbortController(),
        deadline = setTimeout(() => abort.abort(), 10000)
      try {
        const address = sails.hooks.http.server.address()
        const response = await fetch(
          `http://127.0.0.1:${address.port}${base}/stream`,
          { headers: streamHeaders, signal: abort.signal }
        )
        assert.equal(response.status, 200)
        const reader = response.body.getReader()
        assert.equal((await reader.read()).done, false)
        assert.equal(
          (await call('run', { runId: disconnected.run.runId })).run.state,
          'running'
        )
        await reader.cancel()
      } finally {
        clearTimeout(deadline)
        abort.abort()
      }
      assert.equal(
        (await waitForRun(disconnected.run.runId)).state,
        'completed'
      )
      await readPersisted(disconnected.run.runId, 'completed')
      const repeat = await client.post(
        `${base}/jobs/slow-job/run`,
        disconnected.body
      )
      assert.equal(repeat.status, 202)
      assert.equal(repeat.data.run.runId, disconnected.run.runId)
      assert.equal(
        businessFor(await evidence(), 'slow-job').filter(
          (event) => event.inputs.label === 'disconnected-reader'
        ).length,
        1
      )

      const member = await world
        .create('user')
        .with({ team: current.teams.genesisTeam.id, teamRole: 'member' })
      const reader = await bearerRequest(context, member)
      assert.equal((await reader.get(`${base}/runs/${runId}`)).status, 200)
      assert.equal(
        (
          await reader.post(
            `${base}/jobs/rebuild-search-index/run`,
            await bodyFor('rebuild-search-index', inputs)
          )
        ).status,
        403
      )
      assert.equal(
        (
          await reader.post(`/projects/${slug}/quest/slow-job/pause`, {
            runtimeId: initial.runtimeId
          })
        ).status,
        403
      )
      const foreign = await world.create('user').with({ teamRole: 'owner' })
      const foreignTeam = await world.create('team').with({ owner: foreign.id })
      await sails.models.user
        .updateOne({ id: foreign.id })
        .set({ team: foreignTeam.id })
      const foreignClient = await bearerRequest(
        context,
        await sails.models.user.findOne({ id: foreign.id })
      )
      for (const suffix of [`/runs/${runId}`, `/runs/${runId}/logs`])
        assert.equal((await foreignClient.get(`${base}${suffix}`)).status, 404)

      const recovery = await recoveryTrials({
        sails,
        app,
        fixture,
        client,
        base,
        invoke,
        call,
        refresh,
        snapshot,
        evidence,
        waitForRun,
        readPersisted
      })
      const lost = await invoke('slow-job', {
        label: 'restart-evidence-loss',
        delayMs: 6500
      })
      await fixture.waitFor(
        evidence,
        (items) =>
          businessFor(items, 'slow-job').some(
            (event) => event.inputs.label === 'restart-evidence-loss'
          ),
        'actual active business child'
      )
      await fixture.inspect('restart')
      const restarted = await fixture.waitFor(
        () => fixture.inspect('ready'),
        (ready) => ready.runtimeId !== initial.runtimeId,
        'new resident identity'
      )
      assert.notEqual(restarted.pid, fixture.ready.pid)
      await assert.rejects(
        call('invoke', { name: 'slow-job', ...lost.body }),
        /unavailable|unconfirmed|restarted/i
      )
      workspace.invalidate(app)
      assert.equal((await refresh()).target.runtimeId, restarted.runtimeId)
      assert.equal(
        (await readPersisted(lost.run.runId, 'unconfirmed')).result.status,
        'unavailable'
      )
      await assert.rejects(call('run', { runId: lost.run.runId }), {
        code: 'QUEST_RUN_UNAVAILABLE'
      })
      assert.equal(
        (await client.post(`${base}/jobs/slow-job/run`, lost.body)).status,
        409
      )
      await sleep(7000)
      assert.equal(
        businessFor(await evidence(), 'slow-job').filter(
          (event) => event.inputs.label === 'restart-evidence-loss'
        ).length,
        1
      )
      assert.equal(
        (await readPersisted(lost.run.runId, 'unconfirmed')).state,
        'unconfirmed'
      )
      assert.equal((await fixture.inspect('ownership')).live.length, 1)
      const finalEvents = await evidence(),
        loads = finalEvents.filter((event) => event.kind === 'sails-load')
      const residentPids = new Set([fixture.ready.pid, restarted.pid])
      assert.equal(
        loads.filter((event) => residentPids.has(event.pid)).length,
        2
      )
      assert.ok(
        loads.filter((event) => !residentPids.has(event.pid)).length > 0
      )
      for (const load of loads.filter(
        (event) => !residentPids.has(event.pid)
      )) {
        assert.equal(load.autoStart, false)
        assert.equal(load.migrate, 'safe')
      }
      const proof = {
        upstream: fixture.source,
        workerOnly: true,
        runtimeIds: [initial.runtimeId, restarted.runtimeId],
        manualRunId: runId,
        directHelperParity: {
          helper: helperReference.helper,
          residentPid: helperReference.pid,
          inputs: helperReference.inputs,
          result: helperReference.result,
          questRunId: runId
        },
        browserRunId,
        scheduledRunId: scheduled.runId,
        signalRunId: signaled.run.runId,
        unconfirmedRunId: lost.run.runId,
        recovery,
        scheduleDiagnostics: {
          invalid: invalidSchedule.scheduleState,
          expired: expiredSchedule.scheduleState,
          stopped: stoppedSchedule.scheduleState,
          consumed: consumedJob.scheduleState,
          effectiveCronTimezone: timezoneCron.timezone
        },
        observedSailsLoads: loads.length,
        observedStarts: finalEvents.filter(
          (event) => event.kind === 'quest:start'
        ).length,
        transport: 'Real Docker exec/private UDS + real dashboard HTTP/browser',
        cancellation: 'unsupported'
      }
      const root = path.resolve('.tmp/screenshots/quest-real-resident')
      await fs.mkdir(root, { recursive: true })
      await fs.writeFile(
        path.join(root, 'integration-proof.json'),
        JSON.stringify(proof, null, 2) + '\n'
      )
      console.log('[Quest resident proof]', JSON.stringify(proof))
    } catch (error) {
      await fixture?.diagnose()
      throw error
    } finally {
      await context.page?.raw.goto('about:blank').catch(() => {})
      restoreDockerBinary?.()
      workspace.invalidate(app)
      await fixture?.close()
    }
  }
)
