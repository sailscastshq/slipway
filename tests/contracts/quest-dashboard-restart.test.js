const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { test } = require('node:test')
const {
  createNativeFixture
} = require('../fixtures/quest-resident/native-fixture.cjs')
const { LIMITS } = require('../fixtures/quest-resident/native-config.cjs')

test(
  'real native web resident survives dashboard SIGKILL, persists telemetry and recovers missing evidence without replay',
  { timeout: 240000 },
  async () => {
    const fixture = await createNativeFixture()
    let proof, cleanup
    try {
      const a = await fixture.dashboard('A')
      const web = await fixture.web()
      const health = async () => {
        const response = await fetch(
          `http://127.0.0.1:${web.identity.port}/health`,
          { signal: AbortSignal.timeout(5000) }
        )
        assert.equal(response.status, 200)
        assert.deepEqual(await response.json(), { ok: true, pid: web.pid })
      }
      await health()
      const initial = await fixture.call('snapshot')
      assert.equal(initial.runtimeId, web.identity.runtimeId)
      assert.equal(initial.jobs.length, 39)
      assert.equal(initial.capabilities.invoke, true)
      assert.equal(initial.capabilities.results, true)
      for (const job of initial.jobs)
        assert.equal(job.inputMetadataAvailable, true)
      const starts = () =>
        fixture.evidence().filter((event) => event.kind === 'quest:start')
      const invoke = async (name, jobInputs = {}) => {
        const job = initial.jobs.find((item) => item.name === name)
        assert.ok(job)
        const admitted = await fixture.call('invoke', {
          runtimeId: initial.runtimeId,
          name,
          metadataVersion: job.metadataVersion,
          requestId: randomUUID(),
          jobInputs
        })
        return (
          await fixture.waitFor(
            () =>
              fixture.call('run', {
                runId: admitted.run.runId,
                runtimeId: initial.runtimeId
              }),
            ({ run }) => ['completed', 'failed'].includes(run.state),
            `real terminal ${name}`
          )
        ).run
      }
      const sentinel = async () => {
        const run = await invoke('throwing-job')
        assert.equal(run.state, 'failed')
        assert.equal(run.exitCode, 1)
        assert.match(
          `${run.error}\n${run.stderr}`,
          /Synthetic business failure/
        )
        return run
      }
      const read = (dashboard, runId, logs = false) =>
        dashboard.call('read', { runId, logs })
      const sameLifecycle = (stored, resident) => {
        for (const field of [
          'runId',
          'runtimeId',
          'requestedAt',
          'startedAt',
          'finishedAt'
        ])
          assert.equal(
            stored[field],
            resident[field],
            `Persisted ${field} preserves the actual resident value`
          )
      }
      const persisted = async (dashboard, run) =>
        fixture.waitFor(
          () => read(dashboard, run.runId),
          (response) =>
            response.status === 200 && response.data.run.state === run.state,
          `authenticated persisted ${run.jobName}`
        )

      const index = await invoke('rebuild-search-index', {
        collection: 'articles',
        batchSize: 200,
        dryRun: true
      })
      assert.deepEqual(index.result.value, {
        indexed: 240,
        skipped: 3,
        dryRun: true
      })
      assert.equal(index.result.status, 'available')
      const firstSentinel = await sentinel() // Actual error lifecycle owns the flush.
      const originalReceipt = await persisted(a, index)
      sameLifecycle(originalReceipt.data.run, index)
      assert.deepEqual(
        originalReceipt.data.run.result.value,
        index.result.value
      )
      const originalLogs = await read(a, index.runId, true)
      assert.equal(originalLogs.status, 200)
      assert.match(originalLogs.data.stdout, /999999/)
      assert.match(originalLogs.data.stderr, /fixture-warning/)
      await persisted(a, firstSentinel)
      assert.ok(
        fixture
          .evidence()
          .some(
            (event) =>
              event.kind === 'telemetry:ingest' &&
              event.generation === 'A' &&
              event.status === 200
          )
      )

      const killed = await fixture.killDashboard(a)
      assert.equal(a.exited, true)
      assert.equal(killed.signal, 'SIGKILL')
      await health() // The same real HTTP app process survived the dashboard death.
      assert.equal(
        (await fixture.call('snapshot')).runtimeId,
        initial.runtimeId
      )
      const errorsBefore = fixture
        .evidence()
        .filter((event) => event.kind === 'telemetry:error').length
      const typedInputs = {
        count: 0,
        enabled: false,
        label: '001',
        payload: { zero: 0, flag: false, nothing: null, rows: [] }
      }
      const missing = await invoke('typed-report', typedInputs)
      assert.equal(missing.state, 'completed')
      assert.deepEqual(missing.result.value, typedInputs)
      await sentinel()
      await fixture.waitFor(
        () =>
          fixture
            .evidence()
            .filter((event) => event.kind === 'telemetry:error'),
        (events) =>
          events.length > errorsBefore && events.at(-1).code === 'ECONNREFUSED',
        'actual refused telemetry delivery while dashboard is dead'
      )

      const b = await fixture.dashboard('B')
      assert.notEqual(b.pid, a.pid)
      assert.equal(b.identity.port, a.identity.port)
      // Read first: no resident synchronization, run writes or replay before
      // proving SQLite survived the genuine process death.
      assert.deepEqual(await read(b, index.runId), originalReceipt)
      assert.deepEqual(await read(b, index.runId, true), originalLogs)
      const startsBeforeRecovery = starts().length
      // No resident recovery request: retry only the private retained receipt.
      const recovered = await persisted(b, missing)
      assert.equal(recovered.status, 200)
      assert.equal(recovered.data.run.runId, missing.runId)
      assert.equal(recovered.data.run.runtimeId, initial.runtimeId)
      sameLifecycle(recovered.data.run, missing)
      assert.deepEqual(recovered.data.run.result.value, typedInputs)
      assert.equal(starts().length, startsBeforeRecovery)
      assert.equal(
        (await fixture.call('snapshot')).runtimeId,
        initial.runtimeId
      )
      await health()

      const burst = []
      for (let offset = 0; offset < 36; offset += LIMITS.parallel) {
        const runs = await Promise.all(
          Array.from({ length: LIMITS.parallel }, async (_, slot) => {
            const index = offset + slot
            const label = `burst-${index}`
            const run = await invoke(`telemetry-burst-${index}`, { label })
            assert.equal(run.state, 'completed')
            assert.deepEqual(run.result.value, {
              label,
              payload: 'x'.repeat(16000)
            })
            return run
          })
        )
        burst.push(...runs)
      }
      const finalSentinel = await sentinel()
      await persisted(b, finalSentinel)
      for (const run of burst) {
        const response = await persisted(b, run)
        assert.equal(response.data.run.runtimeId, initial.runtimeId)
        sameLifecycle(response.data.run, run)
        assert.deepEqual(response.data.run.result.value, run.result.value)
        assert.equal(response.data.run.result.status, 'available')
      }

      const events = fixture.evidence()
      assert.ok(
        events.some(
          (event) =>
            event.kind === 'telemetry:ingest' &&
            event.body.questEvents?.some(
              (item) => item.run.runId === missing.runId
            )
        ),
        'Missing receipt is delivered from disk without resident recovery or execution replay'
      )
      const ingests = events.filter(
        (event) => event.kind === 'telemetry:ingest'
      )
      assert.ok(ingests.length >= 4)
      let wireBytes = 0,
        wireEvents = 0
      const allMetrics = []
      for (const packet of ingests) {
        assert.equal(
          packet.status,
          200,
          'Every actual received packet is accepted'
        )
        assert.ok(packet.bytes > 0 && packet.bytes <= 512 * 1024)
        assert.equal(
          Buffer.byteLength(JSON.stringify(packet.body)),
          packet.bytes
        )
        if (packet.body.questEvents) {
          assert.ok(packet.body.questEvents.length <= 8)
          wireBytes += packet.bytes
          for (const item of packet.body.questEvents) {
            assert.ok(Buffer.byteLength(JSON.stringify(item)) <= 32 * 1024)
            assert.match(item.id, /^[a-f0-9]{64}$/)
          }
          continue
        }
        assert.ok(Number.isFinite(packet.body.registration.startedAt))
        wireBytes += packet.bytes
        for (const [kind, limit, timestamp] of [
          ['spans', 500, 'startedAt'],
          ['exceptions', 200, 'occurredAt'],
          ['metrics', 1000, 'recordedAt']
        ]) {
          assert.ok(Array.isArray(packet.body[kind]))
          assert.ok(packet.body[kind].length <= limit)
          wireEvents += packet.body[kind].length
          for (const event of packet.body[kind]) {
            assert.ok(
              Number.isFinite(event[timestamp]),
              `Numeric ${kind} wrapper timestamp`
            )
            assert.ok(Buffer.byteLength(JSON.stringify(event)) <= 32 * 1024)
          }
        }
        allMetrics.push(...packet.body.metrics)
      }
      assert.ok(wireBytes < 2 * 1024 * 1024)
      assert.ok(wireEvents < 3000)
      assert.ok(ingests.length < 120)
      const burstIds = new Set(burst.map((run) => run.runId))
      const burstPackets = ingests.filter((packet) =>
        packet.body.metrics.some((metric) =>
          burstIds.has(metric.attributes?.questRun?.runId)
        )
      )
      assert.ok(
        burstPackets.length >= 2,
        'The real 16 KiB result burst exercises multi-packet delivery'
      )
      assert.ok(
        burstPackets.reduce((sum, packet) => sum + packet.bytes, 0) > 512 * 1024
      )
      for (const run of burst) {
        for (const name of ['quest.job.start', 'quest.job.complete'])
          assert.equal(
            allMetrics.filter(
              (metric) =>
                metric.name === name &&
                metric.attributes?.questRun?.runId === run.runId
            ).length,
            1
          )
        for (const kind of ['quest:start', 'quest:complete'])
          assert.equal(
            events.filter(
              (event) => event.kind === kind && event.runId === run.runId
            ).length,
            1
          )
      }
      assert.equal(
        allMetrics.filter(
          (metric) => metric.attributes?.questRun?.runId === missing.runId
        ).length,
        0,
        'Generic metrics remain best effort; durable receipt replay does not duplicate them'
      )
      await fixture.waitFor(
        () =>
          fixture
            .evidence()
            .filter((event) => event.kind === 'telemetry:response'),
        (responses) => responses.length === ingests.length,
        'passive client response diagnostics'
      )
      for (const event of fixture
        .evidence()
        .filter((event) => event.kind === 'telemetry:response'))
        assert.equal(event.status, 200)
      const loads = events.filter((event) => event.kind === 'sails-load')
      assert.equal(loads.length, LIMITS.expectedLoads)
      assert.equal(starts().length, LIMITS.expectedStarts)
      assert.equal(
        new Set(starts().map((event) => event.runId)).size,
        LIMITS.expectedStarts
      )
      for (const start of starts())
        assert.equal(
          events.filter(
            (event) =>
              ['quest:complete', 'quest:error'].includes(event.kind) &&
              event.runId === start.runId
          ).length,
          1
        )
      assert.equal(loads.filter((event) => !event.cli).length, 1)
      assert.equal(loads.filter((event) => !event.cli)[0].pid, web.pid)
      let active = 0,
        highWater = 0
      for (const event of events) {
        if (event.kind === 'quest:start') {
          active++
          highWater = Math.max(highWater, active)
        }
        if (['quest:complete', 'quest:error'].includes(event.kind)) active--
        assert.ok(active >= 0 && active <= LIMITS.parallel)
      }
      assert.equal(active, 0)
      const budget = await b.call('budget')
      assert.equal(budget.rows.length, 1)
      for (const row of budget.rows) {
        assert.ok(
          row.bytes < 2 * 1024 * 1024 && row.events < 3000 && row.requests < 120
        )
        assert.equal(row.rejected_events, 0)
        assert.equal(row.rejected_requests, 0)
      }
      // 41 real runs minus two lost offline rows plus the explicitly recovered one.
      assert.equal(budget.receipts, 40)
      proof = {
        upstream: { sha: fixture.source.sha, version: fixture.source.version },
        packedConsumer: fixture.packedProof,
        proof:
          'CI-native real dashboard process restart + real web app + real HTTP telemetry; direct private-UDS recovery sub-proof',
        dashboardGenerations: [
          { generation: 'A', pid: a.pid, migrate: 'drop', exit: killed },
          { generation: 'B', pid: b.pid, migrate: 'safe' }
        ],
        web: {
          pid: web.pid,
          runtimeId: initial.runtimeId,
          survivedDashboardKill: true,
          http: true
        },
        persistedRunId: index.runId,
        recoveredRunId: missing.runId,
        oldReceiptAndLogsUnchanged: true,
        missingBeforeRecovery: 404,
        startsAddedByRecovery: 0,
        burst: {
          results: burst.length,
          exactStartsAndCompletions: true,
          packets: burstPackets.length
        },
        transport: {
          acceptedRequests: ingests.length,
          bytes: wireBytes,
          events: wireEvents,
          refusedOfflineDelivery: true
        },
        observedStarts: starts().length,
        observedLoads: loads.length,
        maximumConcurrentChildren: highWater,
        budgets: budget.rows,
        ...fixture.summary()
      }
    } catch (error) {
      const diagnostics = fixture.diagnostics()
      if (diagnostics) console.error(diagnostics)
      throw error
    } finally {
      cleanup = await fixture.close()
    }
    // Nothing is called a proof until every assertion AND owned cleanup succeeded.
    proof.cleanup = cleanup
    const output = path.resolve(
      '.tmp/screenshots/quest-real-resident/native-restart-proof.json'
    )
    const json = JSON.stringify(proof, null, 2) + '\n'
    assert.ok(Buffer.byteLength(json) < LIMITS.bytes)
    await fs.mkdir(path.dirname(output), { recursive: true })
    await fs.writeFile(output, json, { mode: 0o600 })
    console.log('[Quest native restart proof]', json)
  }
)
