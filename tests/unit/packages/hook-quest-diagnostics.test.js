const assert = require('node:assert/strict')
const http = require('node:http')
const { EventEmitter } = require('node:events')
const { test } = require('sounding')
const defineSlipwayHook = require('../../../packages/hook')
const questEvent = require('../../../packages/hook/lib/quest-event')
const {
  normalizeQuestDiagnostic
} = require('../../../packages/hook/lib/quest-diagnostics')

test('Quest diagnostics are useful, bounded, redacted, and backward compatible', ({
  expect
}) => {
  const trace = normalizeQuestDiagnostic(
    {
      diagnostic:
        '\u001b[31mError: database exploded\u001b[0m\n    at sendIssueNotifications (/app/scripts/send-issue-notifications.js:12:3)\nAPI_TOKEN=visible-token Bearer visible-token',
      stack: 'Error: Job exited with code 1\n    at executor.js:143:23'
    },
    {
      environment: { API_TOKEN: 'visible-token' },
      maxBytes: 1024
    }
  )

  expect(trace).toContain('sendIssueNotifications')
  expect(trace).toContain('Quest runner:')
  expect(trace).toContain('executor.js')
  expect(trace.includes('visible-token')).toBe(false)
  expect(trace.includes('\u001b')).toBe(false)
  expect(Buffer.byteLength(trace) <= 1024).toBe(true)

  expect(
    normalizeQuestDiagnostic({ stack: 'Error: older Quest payload' })
  ).toBe('Error: older Quest payload')
  expect(normalizeQuestDiagnostic({ message: 'no trace available' })).toBe(null)
})

test('Quest telemetry retains a bounded named exit when the business value exceeds its transport budget', () => {
  for (const exit of ['noRecords', 'x'.repeat(129)]) {
    const event = questEvent(
      {
        name: 'synthetic-report',
        runId: 'bounded-business-value',
        runtimeId: 'synthetic-runtime',
        sequence: 2,
        result: { status: 'available', value: 'r'.repeat(20000), exit }
      },
      'completed',
      { sails: {}, appId: '7', deploymentId: '42' }
    )
    assert.equal(event.result.status, 'too_large')
    assert.equal(event.result.exit, exit === 'noRecords' ? exit : undefined)
    assert.equal(event.exitCode, 0)
  }
})

test('Quest skip telemetry preserves identity and reason without fabricating a child or trigger', () => {
  for (const trigger of [
    undefined,
    'untrusted-origin',
    'scheduled',
    'manual',
    'cli'
  ]) {
    const event = questEvent(
      {
        name: 'synthetic-report',
        runId: 'skipped-attempt',
        runtimeId: 'synthetic-runtime',
        sequence: 5,
        startedAt: new Date(), // Actual upstream attaches this before its guard.
        timestamp: new Date(),
        duration: 0,
        exitCode: 0,
        trigger,
        reason: 'already_running',
        result: { status: 'available', value: 'not a business result' },
        logs: { stdout: 'not child output', stderr: '' }
      },
      'skipped',
      { sails: {}, appId: '7', deploymentId: '42' }
    )
    assert.equal(event.runId, 'skipped-attempt')
    assert.equal(event.state, 'skipped')
    assert.equal(event.startedAt, null)
    assert.equal(event.duration, null)
    assert.equal(event.exitCode, null)
    assert.deepEqual(event.result, { status: 'unavailable' })
    assert.equal(event.stdout, null)
    assert.equal(event.stderr, null)
    assert.equal(event.logsTruncated, false)
    assert.equal(event.error, 'already_running')
    assert.equal(
      event.trigger,
      ['manual', 'scheduled', 'cli'].includes(trigger) ? trigger : 'unknown'
    )
  }
})

test('Quest failure telemetry redacts every error copy and excludes explicit pre-admission validation rejection', async () => {
  const requests = []
  const notifications = []
  const originalRequest = http.request
  const priorSecret = process.env.QUEST_TEST_SECRET
  process.env.QUEST_TEST_SECRET = 'synthetic-environment-secret'
  http.request = () => {
    const request = new EventEmitter()
    let body = ''
    request.write = (chunk) => {
      body += chunk
    }
    request.end = () => requests.push(JSON.parse(body))
    request.destroy = () => {}
    return request
  }
  const sails = new EventEmitter()
  Object.assign(sails, {
    config: {
      slipway: {
        quest: { enabled: false },
        wake: { enabled: false },
        bridge: { enabled: false },
        bearing: { enabled: false },
        flags: { enabled: false },
        lookout: {
          enabled: true,
          telemetryUrl: 'http://127.0.0.1/api/v1/telemetry/ingest',
          telemetryToken: 'stk_disposable-test',
          appId: '7',
          deploymentId: '42',
          heartbeatInterval: 60000,
          flushInterval: 60000,
          batchSize: 2,
          captureExceptions: false,
          captureQueries: false,
          captureQuestEvents: true,
          captureCache: false
        }
      }
    },
    hooks: { helpers: { furnishHelper: () => {} } },
    helpers: {
      notification: {
        sendJobFailureNotification: {
          with(values) {
            notifications.push(values)
            return { tolerate: () => {} }
          }
        }
      }
    },
    models: {},
    quest: { metadata: () => ({ inputs: {} }) },
    log: { verbose: () => {}, info: () => {}, warn: () => {} },
    after(event, callback) {
      if (event === 'hook:helpers:loaded') callback()
    }
  })
  const hook = defineSlipwayHook(sails)
  try {
    await new Promise((resolve, reject) =>
      hook.initialize((error) => (error ? reject(error) : resolve()))
    )
    const rejected = {
      name: 'synthetic-report',
      runId: 'rejected-before-child-start',
      runtimeId: 'synthetic-runtime',
      sequence: 1,
      admission: 'rejected_before_start',
      phase: 'validation',
      error: Object.assign(new Error('Missing required synthetic field'), {
        admissionCode: 'E_QUEST_ADMISSION_REJECTED',
        validationCode: 'E_MISSING_OR_INVALID_PARAMS'
      })
    }
    const before = requests.length
    sails.emit('quest:job:error', rejected)
    assert.equal(requests.length, before)
    assert.equal(notifications.length, 0)
    assert.equal(questEvent(rejected, 'failed', { sails }), null)
    // Exercise both correlated resident events and old uncorrelated events.
    for (const identity of [
      { runId: 'actual-run', runtimeId: 'synthetic-runtime', sequence: 2 },
      {}
    ])
      sails.emit('quest:job:error', {
        name: 'synthetic-report',
        ...identity,
        error: new Error(
          'Harmless fixture failure: synthetic-environment-secret TOKEN=synthetic-assignment Bearer synthetic-bearer'
        )
      })
    const serialized = JSON.stringify({ requests, notifications })
    for (const secret of [
      'synthetic-environment-secret',
      'synthetic-assignment',
      'synthetic-bearer'
    ])
      assert.equal(serialized.includes(secret), false)
    const metrics = requests.flatMap((item) => item.metrics)
    const exceptions = requests.flatMap((item) => item.exceptions)
    assert.equal(metrics.length, 2)
    assert.equal(exceptions.length, 2)
    assert.equal(notifications.length, 2)
    assert.equal(metrics[0].attributes.questRun.state, 'failed')
    assert.equal(metrics[1].attributes.questRun, undefined)
    assert.match(metrics[0].attributes.error, /Harmless fixture failure/)
    assert.match(exceptions[0].message, /<redacted>/)
    assert.match(notifications[0].errorMessage, /<redacted>/)
    const beforeSkips = requests.length
    for (const [i, reason] of ['paused', 'already_running'].entries()) {
      sails.emit('quest:job:skip', {
        name: 'synthetic-report',
        runId: `skipped-${i}`,
        runtimeId: 'synthetic-runtime',
        sequence: i + 10,
        startedAt: new Date(),
        timestamp: new Date(),
        reason
      })
      assert.equal(requests.length, beforeSkips + (i === 1 ? 1 : 0))
    }
    const skips = requests.at(-1)
    assert.equal(skips.metrics.length, 2)
    assert.deepEqual(skips.exceptions, [])
    assert.equal(notifications.length, 2)
    for (const metric of skips.metrics) {
      assert.equal(metric.name, 'quest.job.skipped')
      assert.equal(metric.attributes.questRun.state, 'skipped')
      assert.equal(metric.attributes.questRun.startedAt, null)
      assert.equal(metric.attributes.questRun.trigger, 'unknown')
      assert.equal(metric.attributes.questRun.exitCode, null)
    }
  } finally {
    await new Promise((resolve) => hook.teardown(resolve))
    http.request = originalRequest
    if (priorSecret === undefined) delete process.env.QUEST_TEST_SECRET
    else process.env.QUEST_TEST_SECRET = priorSecret
  }
})
