/**
 * Explicit, disposable SQLite history benchmark (not a default test lane).
 *
 * Run:
 *   npx sounding test --file tests/contracts/quest-history-budget.test.js --test-concurrency=1
 *
 * Optional report:
 *   SLIPWAY_QUEST_HISTORY_REPORT=.tmp/quest-history-budget.json <command above>
 *
 * This compares only the initial history JSON envelopes, not complete Inertia
 * pages, network compression, DOM rendering, Docker, or resident job execution.
 * Timings are observations from warmed in-memory SQLite, never pass/fail gates.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { performance } = require('node:perf_hooks')
const { test } = require('sounding')
const ledger = require('../../api/lib/quest-run-ledger')

const EVENT_COUNT = 500
const STREAM_BYTES = 32 * 1024
const SAMPLES = 7
const bytes = (value) => Buffer.byteLength(JSON.stringify(value))
const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const round = (value) => Number(value.toFixed(3))

function syntheticLog(label) {
  const prefix = `${label}: fixture only, no job was executed.\n`
  return prefix + '.'.repeat(STREAM_BYTES - Buffer.byteLength(prefix))
}

test(
  'Quest history keeps initial summary JSON bounded with 500 actual SQLite log-heavy events',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'quest-history-budget' } }
    }
  },
  async ({ world, sails }) => {
    assert.equal(sails.config.datastores.observability.adapter, 'sails-sqlite')
    assert.equal(
      sails.config.datastores.observability.url,
      ':memory:',
      'This benchmark must use disposable in-memory SQLite.'
    )
    const scope = {
      environmentId: world.current.environments.production.id,
      appId: world.current.apps.web.id
    }
    const now = Date.now()
    const stdout = syntheticLog('STDOUT_SYNTHETIC')
    const stderr = syntheticLog('STDERR_SYNTHETIC')
    assert.equal(Buffer.byteLength(stdout), STREAM_BYTES)
    assert.equal(Buffer.byteLength(stderr), STREAM_BYTES)
    for (let start = 0; start < EVENT_COUNT; start += 25) {
      await sails.models.telemetrymetric.createEach(
        Array.from({ length: 25 }, (_, offset) => {
          const index = start + offset
          return {
            name: index % 4 === 0 ? 'quest.job.error' : 'quest.job.complete',
            value: 100 + index,
            unit: 'ms',
            environment: String(scope.environmentId),
            recordedAt: now - EVENT_COUNT + index,
            attributes: {
              jobName: 'synthetic-history-budget',
              trigger: 'scheduled',
              stdout,
              stderr,
              ...(index % 4 === 0 ? { error: 'Synthetic diagnostic only' } : {})
            }
          }
        })
      )
    }
    assert.equal(
      await sails.models.telemetrymetric.count({
        environment: String(scope.environmentId)
      }),
      EVENT_COUNT
    )
    assert.equal(
      await sails.models.questrun.count({
        environment: String(scope.environmentId)
      }),
      0
    )

    const readLegacy = () =>
      sails.helpers.quest.getJobHistory(scope.environmentId)
    const readSummaries = () => ledger.listRuns(scope)
    // Warm each query once before alternating read order to reduce order bias.
    await readLegacy()
    await readSummaries()
    const measurements = { legacy: [], summary: [] }
    const jsonBytes = { legacy: [], summary: [] }
    const measure = async (kind, read) => {
      const startedAt = performance.now()
      const value = await read()
      measurements[kind].push(performance.now() - startedAt)
      const envelope = kind === 'legacy' ? { jobHistory: value } : value
      jsonBytes[kind].push(bytes(envelope))
      if (kind === 'legacy') {
        assert.equal(value.length, EVENT_COUNT)
        assert.equal(Buffer.byteLength(value[0].stdout), STREAM_BYTES)
      } else {
        assert.equal(value.runs.length + value.legacyEvents.length, 25)
        assert.equal(
          value.runs.length,
          0,
          'Uncorrelated events remain legacy events.'
        )
        assert.ok(value.nextCursor)
        assert.ok(bytes(value) <= 64 * 1024)
        for (const row of value.legacyEvents) {
          assert.deepEqual(
            Object.keys(row).sort(),
            [
              'eventId',
              'jobName',
              'event',
              'duration',
              'error',
              'trigger',
              'recordedAt',
              'legacy'
            ].sort()
          )
        }
        assert.equal(JSON.stringify(value).includes('STDOUT_SYNTHETIC'), false)
        assert.equal(JSON.stringify(value).includes('STDERR_SYNTHETIC'), false)
      }
    }
    for (let sample = 0; sample < SAMPLES; sample++) {
      if (sample % 2 === 0) {
        await measure('legacy', readLegacy)
        await measure('summary', readSummaries)
      } else {
        await measure('summary', readSummaries)
        await measure('legacy', readLegacy)
      }
    }
    assert.equal(new Set(jsonBytes.legacy).size, 1)
    assert.equal(new Set(jsonBytes.summary).size, 1)
    const firstPage = await readSummaries()
    const nextPage = await ledger.listRuns(scope, {
      cursor: firstPage.nextCursor
    })
    assert.equal(nextPage.legacyEvents.length, 25)
    assert.equal(
      new Set(
        [...firstPage.legacyEvents, ...nextPage.legacyEvents].map(
          (event) => event.eventId
        )
      ).size,
      50
    )
    const detailStartedAt = performance.now()
    const detail = await ledger.getEvent(
      scope,
      firstPage.legacyEvents[0].eventId
    )
    const detailMs = performance.now() - detailStartedAt
    assert.equal(detail.stdout, stdout)
    assert.equal(detail.stderr, stderr)

    const report = {
      benchmark: 'quest-history-budget-v1',
      observedAt: new Date().toISOString(),
      runtime: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        datastore: 'actual sails-sqlite :memory:'
      },
      fixture: {
        events: EVENT_COUNT,
        correlatedRuns: 0,
        jobName: 'synthetic-history-budget',
        stdoutBytesPerEvent: STREAM_BYTES,
        stderrBytesPerEvent: STREAM_BYTES,
        totalHistoricalLogBytes: EVENT_COUNT * STREAM_BYTES * 2,
        completedEvents: 375,
        failedEvents: 125
      },
      method: {
        samplesPerReader: SAMPLES,
        warmupReadsPerReader: 1,
        alternatingOrder: true,
        timingIncludes:
          'database read and JavaScript mapping; excludes JSON serialization',
        jsonBytes: 'uncompressed initial history envelopes only',
        timingIsObservational: true
      },
      legacy: {
        reader: 'sails.helpers.quest.getJobHistory',
        records: EVENT_COUNT,
        initialHistoryJsonBytes: jsonBytes.legacy[0],
        medianReadMs: round(median(measurements.legacy)),
        samplesMs: measurements.legacy.map(round)
      },
      summary: {
        reader: 'ledger.listRuns',
        records: 25,
        initialHistoryJsonBytes: jsonBytes.summary[0],
        medianReadMs: round(median(measurements.summary)),
        samplesMs: measurements.summary.map(round),
        nextCursor: Boolean(firstPage.nextCursor),
        inlinePayloads: false
      },
      lazyDetail: {
        reader: 'ledger.getEvent',
        stdoutBytes: Buffer.byteLength(detail.stdout),
        stderrBytes: Buffer.byteLength(detail.stderr),
        jsonBytes: bytes({ event: detail }),
        readMs: round(detailMs)
      },
      limitations: [
        'Synthetic log-heavy fixture',
        'Warmed in-memory SQLite on one executor',
        'Not an end-to-end page or resident runtime benchmark',
        'No production timing, compression or general no-regression claim'
      ]
    }
    if (process.env.SLIPWAY_QUEST_HISTORY_REPORT) {
      const filename = path.resolve(process.env.SLIPWAY_QUEST_HISTORY_REPORT)
      fs.mkdirSync(path.dirname(filename), { recursive: true })
      fs.writeFileSync(filename, JSON.stringify(report, null, 2) + '\n')
    }
    console.log('QUEST_HISTORY_BUDGET_RESULT ' + JSON.stringify(report))
  }
)
