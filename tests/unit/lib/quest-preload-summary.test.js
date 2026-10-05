const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { test } = require('sounding')

const sourceSha = 'synthetic-same-source'
const captures = [
  'desktop-light',
  'desktop-dark',
  'mobile-light',
  'mobile-dark'
]
const assets = [
  { url: '/js/app.0123456789.js', bytes: 200 },
  { url: '/js/async/1234.0123456789.js', bytes: 100 }
]
const resources = assets.map((asset) => ({
  name: asset.url,
  encodedBodySize: asset.bytes,
  startTime: 20,
  requestStart: 22,
  responseEnd: 30
}))

function fixture(root, change = () => {}) {
  for (const name of ['before-1', 'after-1', 'after-2', 'before-2']) {
    const preloadMode = name.startsWith('before') ? 'off' : 'on'
    const capture = {
      phase: 'after',
      sourceSha,
      captureTrialSourceSha: sourceSha,
      jobs: [],
      events: [],
      captures,
      frozenBrowserTime: 'synthetic-time',
      project: 'synthetic-project',
      team: 'synthetic-team',
      user: 'synthetic-user',
      environment: 'synthetic-environment'
    }
    const performance = {
      sourceSha,
      preloadMode,
      productionBenchmark: true,
      measurementVersion: 2,
      driverReadiness: 'same-synthetic-readiness',
      budgets: {
        questJsonBytes: 1000,
        initialJsonBytes: 1000,
        documentElementCount: 1000,
        navigationToReadyMs: 1000
      },
      productionBuild: {
        sourceSha,
        buildMode: 'production',
        preloads: {
          version: 1,
          mode: 'production',
          page: 'projects/quest',
          assets: [assets[1].url]
        },
        manifest: {
          entries: { app: { initial: { js: [assets[0].url], css: [] } } }
        },
        assets
      },
      measurements: captures.map((capture) => ({
        capture,
        questJsonBytes: 100,
        initialJsonBytes: 200,
        documentBytes: preloadMode === 'on' ? 900 : 800,
        documentElementCount: 100,
        navigationToReadyMs: 80,
        navigationToReadySamplesMs: Array(5).fill(80),
        productionSamples: Array.from({ length: 5 }, () => ({
          native: {
            readyMs: 80,
            contentReadyMs: 60,
            navigation: { responseEnd: 10 },
            resources
          },
          cdpAfter: {
            ScriptDuration: 0.001,
            LayoutDuration: 0.001,
            RecalcStyleDuration: 0.001
          },
          bootstrap: [{ fetchMs: 2, rewriteMs: 1 }]
        }))
      }))
    }
    const interaction = {
      sourceSha,
      preloadMode,
      observations: captures.flatMap((capture) =>
        ['job-click', 'direct-job', 'direct-run'].flatMap((kind) =>
          Array.from({ length: 3 }, () => ({
            capture,
            kind,
            native: {
              elapsedMs: 12,
              resources: kind === 'job-click' ? [] : resources
            },
            geometry: {
              horizontalOverflowPx: 0,
              workspaceHorizontalOverflowPx: 0
            }
          }))
        )
      )
    }
    const data = JSON.parse(
      JSON.stringify({ capture, performance, interaction })
    )
    change(name, data)
    fs.mkdirSync(path.join(root, name))
    for (const [filename, value] of [
      ['fixture.json', data.capture],
      ['performance.json', data.performance],
      ['interaction-performance.json', data.interaction]
    ])
      fs.writeFileSync(path.join(root, name, filename), JSON.stringify(value))
  }
}

function summarize(change) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quest-preload-summary-'))
  try {
    fixture(root, change)
    execFileSync(
      process.execPath,
      [
        path.resolve(__dirname, '../../support/quest-production-benchmark.cjs'),
        'summarize-preload',
        root
      ],
      {
        env: {
          ...process.env,
          SLIPWAY_QUEST_CAPTURE_TRIAL_SHA: sourceSha,
          QUEST_BASELINE_SHA: 'original-page-is-not-this-control',
          GITHUB_STEP_SUMMARY: ''
        },
        stdio: 'pipe'
      }
    )
    return JSON.parse(fs.readFileSync(path.join(root, 'report.json'), 'utf8'))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

test('Quest preload summary preserves same-source on/off control identity and its limits', () => {
  const report = summarize()
  assert.equal(report.comparison, 'same-source preload off versus on')
  assert.equal(report.beforeSourceSha, sourceSha)
  assert.equal(report.afterSourceSha, sourceSha)
  assert.deepEqual(report.preloadControl.order, ['off', 'on', 'on', 'off'])
  assert.equal(report.actionObservations.length, 24)
  assert.equal(report.observations[0].before.documentBytes, 800)
  assert.equal(report.observations[0].after.documentBytes, 900)
  assert.ok(report.limitations.some((text) => text.includes('byte increase')))
})

test('Quest preload summary rejects different source, mode, fixture phase, build assets, requested bytes or deferred inspector work', () => {
  for (const change of [
    (data) => {
      data.performance.sourceSha = 'different-source'
    },
    (data) => {
      data.performance.preloadMode = 'off'
    },
    (data) => {
      data.capture.phase = 'before'
    },
    (data) => {
      data.performance.productionBuild.assets[0].bytes++
    },
    (data) => {
      data.performance.measurements[0].productionSamples[0].native.resources[0]
        .encodedBodySize++
    },
    (data) => {
      data.performance.measurements[0].productionSamples[0].native.resources.push(
        resources[0]
      )
    },
    (data) => {
      data.interaction.preloadMode = 'off'
    },
    (data) => {
      data.interaction.observations[0].native.resources.push(resources[0])
    }
  ])
    assert.throws(() =>
      summarize((name, data) => {
        if (name === 'after-1') change(data)
      })
    )
})
