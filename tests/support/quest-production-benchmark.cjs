// CI-only companion to the bounded Quest comparison trial. Never starts a
// production application: build uses Shipwright alone, serve uses Sounding test.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

async function build() {
  assert.equal(process.env.NODE_ENV, 'production')
  const errors = []
  const app = {
    config: {
      appPath: process.cwd(),
      port: 0,
      shipwright: {
        styles: {},
        js: {},
        ...require(path.resolve('config/shipwright')).shipwright
      }
    },
    log: Object.fromEntries(
      ['verbose', 'silly', 'info', 'warn', 'debug', 'error'].map((level) => [
        level,
        (...args) => {
          if (level === 'error') errors.push(args.map(String))
          console.log(...args)
        }
      ])
    )
  }
  const hook = require('sails-hook-shipwright')(app)
  hook.configure()
  await hook.initialize()
  assert.deepEqual(errors, [], 'Real Shipwright production build must succeed')
  const manifest = JSON.parse(
    fs.readFileSync('.tmp/public/manifest.json', 'utf8')
  )
  assert.ok(manifest.entries.app.initial.js.length)
  assert.ok(manifest.entries.app.initial.css.length)
  const assets = manifest.allFiles
    .filter((file) => /\.(js|css)$/.test(file))
    .map((url) => {
      assert.match(
        url,
        /\.[a-f\d]{8,}\.(js|css)$/,
        'Production assets must have content-hashed URLs'
      )
      const content = fs.readFileSync(path.join('.tmp/public', url))
      if (url.endsWith('.js'))
        assert.ok(
          !content.includes(Buffer.from('rsbuild-hmr')),
          'Production JS must exclude the development HMR client'
        )
      return { url, bytes: content.length }
    })
  fs.writeFileSync(
    '.tmp/quest-production-build.json',
    JSON.stringify(
      {
        sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], {
          encoding: 'utf8'
        }).trim(),
        buildMode: 'production',
        applicationLifted: false,
        manifest,
        assets
      },
      null,
      2
    ) + '\n'
  )
}

function configure() {
  assert.notEqual(
    process.env.NODE_ENV,
    'production',
    'Never lift the app with production NODE_ENV'
  )
  const configPath = path.resolve('config/sounding.js')
  const source = fs.readFileSync(configPath, 'utf8')
  assert.ok(!source.includes('QUEST_PRODUCTION_BENCHMARK_LIFT'))
  const original = require(configPath).sounding
  assert.equal(original.app?.environment || 'test', 'test')
  // This is written only into disposable CI checkouts, identically for each
  // phase. Use the installed Shipwright's own generators, not fabricated tags.
  fs.appendFileSync(
    configPath,
    `\n// QUEST_PRODUCTION_BENCHMARK_LIFT: disposable test configuration only.\nconst { createTagGenerators } = require('sails-hook-shipwright/lib/tags')\nmodule.exports.sounding.app.environment = 'test'\nmodule.exports.sounding.app.liftOptions.hooks.shipwright = false\nmodule.exports.sounding.app.liftOptions.views = { locals: { shipwright: createTagGenerators(__dirname + '/..') } }\n`
  )
}

function summarize(root, { control = false } = {}) {
  const read = (file) =>
    JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'))
  const names = ['before-1', 'after-1', 'after-2', 'before-2']
  const rounds = names.map((name) => ({
    name,
    fixture: read(`${name}/fixture.json`),
    performance: read(`${name}/performance.json`)
  }))
  const ref = rounds[0]
  const median = (values) => {
    const s = [...values].sort((a, b) => a - b)
    return (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2
  }
  for (const round of rounds) {
    const expected = round.name.startsWith('before')
      ? process.env.QUEST_BASELINE_SHA
      : process.env.SLIPWAY_QUEST_CAPTURE_TRIAL_SHA
    assert.equal(round.fixture.sourceSha, expected)
    if (control) assert.equal(round.fixture.phase, 'after')
    assert.equal(round.performance.sourceSha, expected)
    assert.equal(
      round.fixture.captureTrialSourceSha,
      process.env.SLIPWAY_QUEST_CAPTURE_TRIAL_SHA
    )
    assert.equal(round.performance.productionBenchmark, true)
    assert.equal(round.performance.measurementVersion, 2)
    assert.equal(
      round.performance.driverReadiness,
      ref.performance.driverReadiness
    )
    assert.deepEqual(round.performance.budgets, ref.performance.budgets)
    for (const key of [
      'jobs',
      'events',
      'captures',
      'frozenBrowserTime',
      'project',
      'team',
      'user',
      'environment'
    ])
      assert.deepEqual(round.fixture[key], ref.fixture[key])
    assert.equal(round.performance.measurements.length, 4)
    for (const row of round.performance.measurements) {
      assert.equal(row.productionSamples.length, 5)
      assert.equal(row.navigationToReadySamplesMs.length, 5)
      for (const metric of [
        'questJsonBytes',
        'initialJsonBytes',
        'documentElementCount',
        'navigationToReadyMs'
      ])
        assert.ok(row[metric] <= round.performance.budgets[metric])
      for (const ms of row.navigationToReadySamplesMs)
        assert.ok(ms <= round.performance.budgets.navigationToReadyMs)
      for (const sample of row.productionSamples) {
        assert.ok(sample.native.navigation.responseEnd > 0)
        assert.ok(sample.native.readyMs >= sample.native.navigation.responseEnd)
        assert.ok(
          sample.native.resources.some((resource) =>
            /\.js(?:\?|$)/.test(resource.name)
          )
        )
        assert.ok(
          sample.native.resources.every(
            (resource) =>
              !/rsbuild|lazy-compilation|webpack/i.test(resource.name)
          )
        )
        assert.equal(sample.bootstrap.length, 1)
      }
    }
  }
  const metrics = {
    browserReadyMs: (sample) => sample.native.readyMs,
    responseEndToContentReadyMs: (sample) =>
      sample.native.contentReadyMs - sample.native.navigation.responseEnd,
    twoFrameWaitMs: (sample) =>
      sample.native.readyMs - sample.native.contentReadyMs,
    responseEndToReadyMs: (sample) =>
      sample.native.readyMs - sample.native.navigation.responseEnd,
    responseEndMs: (sample) => sample.native.navigation.responseEnd,
    controllerFetchMs: (sample) => sample.bootstrap[0].fetchMs,
    bootstrapRewriteMs: (sample) => sample.bootstrap[0].rewriteMs,
    rawCdpScriptDurationMs: (sample) => sample.cdpAfter.ScriptDuration * 1000,
    rawCdpLayoutDurationMs: (sample) => sample.cdpAfter.LayoutDuration * 1000,
    rawCdpStyleDurationMs: (sample) =>
      sample.cdpAfter.RecalcStyleDuration * 1000,
    allResourceCount: (sample) => sample.native.resources.length,
    allResourceEncodedBytes: (sample) =>
      sample.native.resources.reduce(
        (sum, resource) => sum + resource.encodedBodySize,
        0
      )
  }
  for (const extension of ['js', 'css']) {
    const resources = (sample) =>
      sample.native.resources.filter((resource) =>
        resource.name.endsWith('.' + extension)
      )
    metrics[`${extension}AssetCount`] = (sample) => resources(sample).length
    metrics[`${extension}AssetEncodedBytes`] = (sample) =>
      resources(sample).reduce(
        (sum, resource) => sum + resource.encodedBodySize,
        0
      )
  }
  const observations = ref.performance.measurements.map((row) => {
    const result = { capture: row.capture, before: {}, after: {} }
    for (const phase of ['before', 'after']) {
      const rows = rounds
        .filter((round) => round.name.startsWith(phase))
        .map((round) =>
          round.performance.measurements.find(
            (sample) => sample.capture === row.capture
          )
        )
      result[phase].wallMedianMs = median(
        rows.flatMap((row) => row.navigationToReadySamplesMs)
      )
      for (const [name, value] of Object.entries(metrics))
        result[phase][name] = median(
          rows.flatMap((row) => row.productionSamples).map(value)
        )
    }
    return result
  })
  const actionRounds = names
    .filter((name) => control || name.startsWith('after'))
    .map((name) => ({ name, ...read(`${name}/interaction-performance.json`) }))
  const actionObservations = []
  for (const round of actionRounds) {
    const expected = round.name.startsWith('before')
      ? process.env.QUEST_BASELINE_SHA
      : process.env.SLIPWAY_QUEST_CAPTURE_TRIAL_SHA
    assert.equal(round.sourceSha, expected)
    assert.equal(round.observations.length, 36)
    for (const row of round.observations) {
      assert.ok(
        Number.isFinite(row.native.elapsedMs) && row.native.elapsedMs <= 15000
      )
      assert.ok(row.geometry.horizontalOverflowPx <= 1)
      assert.ok(row.geometry.workspaceHorizontalOverflowPx <= 1)
    }
  }
  for (const phase of control ? ['before', 'after'] : ['after']) {
    for (const capture of observations.map((row) => row.capture)) {
      for (const kind of ['job-click', 'direct-job', 'direct-run']) {
        const rows = actionRounds
          .filter((round) => round.name.startsWith(phase))
          .flatMap((round) =>
            round.observations.filter(
              (row) => row.capture === capture && row.kind === kind
            )
          )
        assert.equal(rows.length, 6)
        const staticAssets = (row) =>
          row.native.resources.filter((resource) =>
            /\.(js|css)$/.test(resource.name)
          )
        actionObservations.push({
          ...(control
            ? { phase: phase === 'before' ? 'pre-split' : 'current' }
            : {}),
          capture,
          kind,
          readyMedianMs: median(rows.map((row) => row.native.elapsedMs)),
          rawReadyMs: rows.map((row) => row.native.elapsedMs),
          resourceCountMedian: median(
            rows.map((row) => row.native.resources.length)
          ),
          resourceEncodedBytesMedian: median(
            rows.map((row) =>
              row.native.resources.reduce(
                (sum, resource) => sum + resource.encodedBodySize,
                0
              )
            )
          ),
          staticAssetCountMedian: median(
            rows.map((row) => staticAssets(row).length)
          ),
          staticAssetEncodedBytesMedian: median(
            rows.map((row) =>
              staticAssets(row).reduce(
                (sum, resource) => sum + resource.encodedBodySize,
                0
              )
            )
          )
        })
      }
    }
  }
  const report = {
    method:
      'Production-built assets; normal disposable Sounding test environment; ABBA same-runner, ten samples per phase/viewport; Date-only shim, native Performance and timers',
    comparison: control
      ? 'pre-split versus current'
      : 'old page versus current',
    beforeSourceSha: process.env.QUEST_BASELINE_SHA,
    afterSourceSha: process.env.SLIPWAY_QUEST_CAPTURE_TRIAL_SHA,
    observations,
    rounds,
    ...(control
      ? { actionObservations, actionRounds }
      : {
          afterOnlyObservations: actionObservations,
          afterOnlyRounds: actionRounds
        }),
    limitations: [
      'Route interception disables browser HTTP cache; both phases use identical uncached synthetic initial navigations',
      'Real stopped-app controller/database work remains inside route.fetch and full timing; no runtime invocation is measured',
      'CDP metrics are raw per-snapshot values, not differences across navigation; no parser-only cost is claimed',
      'One executor, two rounds per phase; no production traffic or universal no-regression claim'
    ]
  }
  const lines = [
    control
      ? '## Quest pre-split control: initial and action costs'
      : '## Quest production-asset navigation observations',
    '',
    report.method,
    '',
    `Before: ${report.beforeSourceSha}`,
    `After: ${report.afterSourceSha}`,
    '',
    '| Viewport | Metric (median) | Before | After |',
    '| --- | --- | ---: | ---: |',
    ...observations.flatMap((row) =>
      Object.keys(row.before).map(
        (metric) =>
          `| ${row.capture} | ${metric} | ${row.before[metric].toFixed(
            3
          )} | ${row.after[metric].toFixed(3)} |`
      )
    ),
    '',
    control
      ? '### Same-runner pre-split and current action costs'
      : '### After-only inspector and direct-navigation costs',
    '',
    control
      ? 'Exact pre-split and current source, same updated fixture/instrumentation, balanced pre-split → current → current → pre-split. Genuine first inspector clicks and full direct links; six samples per phase/path/view. The original old-screen comparison remains separate.'
      : 'No old-page action equivalent or pre-split control is implied. First inspector open uses a genuine click; direct links use full navigation. Six samples per path/view across two rounds; raw values and requests are in JSON.',
    '',
    '| Viewport | Path | Ready median (ms) | Resource count | Resource bytes | JS/CSS count | JS/CSS bytes |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: |',
    ...actionObservations.map(
      (row) =>
        `| ${row.capture} | ${row.phase ? row.phase + ': ' : ''}${
          row.kind
        } | ${row.readyMedianMs.toFixed(3)} | ${row.resourceCountMedian} | ${
          row.resourceEncodedBytesMedian
        } | ${row.staticAssetCountMedian} | ${
          row.staticAssetEncodedBytesMedian
        } |`
    ),
    '',
    ...report.limitations.map((line) => '- ' + line)
  ]
  fs.writeFileSync(
    path.join(root, 'report.json'),
    JSON.stringify(report, null, 2) + '\n'
  )
  fs.writeFileSync(path.join(root, 'report.md'), lines.join('\n') + '\n')
  if (process.env.GITHUB_STEP_SUMMARY)
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n')
}

;(async () => {
  const mode = process.argv[2]
  if (mode === 'build') await build()
  else if (mode === 'configure') configure()
  else if (mode === 'summarize') summarize(process.argv[3])
  else if (mode === 'summarize-control')
    summarize(process.argv[3], { control: true })
  else
    throw new Error(
      'Expected build, configure, summarize, or summarize-control'
    )
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
