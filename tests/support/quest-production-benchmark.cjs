// CI-only companion to the bounded Quest comparison trial. Never starts a
// production application: build uses Shipwright alone, serve uses Sounding test.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')

const selectPath = 'assets/js/components/ui/select/Select.vue'

function selectProvenance(beforeRoot, afterRoot, outputRoot) {
  const git = (cwd, ...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
  const hash = (file) =>
    createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  const source = (cwd, expectedSha) => {
    assert.equal(git(cwd, 'rev-parse', 'HEAD'), expectedSha)
    assert.equal(git(cwd, 'status', '--porcelain', '--untracked-files=no'), '')
    return Object.fromEntries(
      git(cwd, 'ls-tree', '-r', '--full-tree', 'HEAD')
        .split('\n')
        .map((line) => {
          const [identity, filename] = line.split('\t')
          return [filename, identity]
        })
    )
  }
  const beforeSourceSha = process.env.QUEST_BASELINE_SHA
  const afterSourceSha = process.env.SLIPWAY_QUEST_CAPTURE_TRIAL_SHA
  assert.notEqual(beforeSourceSha, afterSourceSha)
  assert.notEqual(process.env.SLIPWAY_QUEST_ATTRIBUTION_TRACE, '1')
  const before = source(beforeRoot, beforeSourceSha)
  const after = source(afterRoot, afterSourceSha)
  const changedFiles = [
    ...new Set([...Object.keys(before), ...Object.keys(after)])
  ]
    .sort()
    .filter((file) => before[file] !== after[file])
    .map((file) => ({
      file,
      before: before[file] || null,
      after: after[file] || null
    }))
  const productionChanges = changedFiles
    .filter(
      ({ file }) =>
        !file.startsWith('docs/') &&
        !file.startsWith('tests/') &&
        file !== '.github/workflows/quest-comparison.yml' &&
        file !== 'packages/hook/README.md'
    )
    .map(({ file }) => file)
  assert.deepEqual(
    productionChanges,
    [selectPath],
    'Select control requires Select.vue to be the only production source change'
  )
  const dependencies = (root) => ({
    packageLockSha256: hash(path.join(root, 'package-lock.json')),
    installedLockSha256: hash(
      path.join(root, 'node_modules/.package-lock.json')
    ),
    versions: Object.fromEntries(
      [
        'playwright-core',
        '@playwright/test',
        'sounding',
        'sails-hook-shipwright',
        'vue',
        '@floating-ui/dom'
      ].map((name) => [
        name,
        JSON.parse(
          fs.readFileSync(
            path.join(root, 'node_modules', name, 'package.json'),
            'utf8'
          )
        ).version
      ])
    ),
    browsers: JSON.parse(
      fs.readFileSync(
        path.join(root, 'node_modules/playwright-core/browsers.json'),
        'utf8'
      )
    ).browsers
  })
  const beforeDependencies = dependencies(beforeRoot)
  const afterDependencies = dependencies(afterRoot)
  assert.deepEqual(
    afterDependencies,
    beforeDependencies,
    'Both real source builds must use identical installed dependencies and browser revisions'
  )
  fs.mkdirSync(outputRoot, { recursive: true })
  for (const [phase, root] of [
    ['before', beforeRoot],
    ['after', afterRoot]
  ])
    fs.copyFileSync(
      path.join(root, selectPath),
      path.join(outputRoot, `Select.${phase}.vue`)
    )
  const report = {
    beforeSourceSha,
    afterSourceSha,
    productionChanges,
    changedFiles,
    selectSourceSha256: {
      before: hash(path.join(beforeRoot, selectPath)),
      after: hash(path.join(afterRoot, selectPath))
    },
    dependencies: beforeDependencies,
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    runner: { image: process.env.ImageOS, version: process.env.ImageVersion },
    instrumentation:
      'No attribution trace or browser probe; unchanged native production measurement trial'
  }
  fs.writeFileSync(
    path.join(outputRoot, 'provenance.json'),
    JSON.stringify(report, null, 2) + '\n'
  )
}

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
  const preloadPath = '.tmp/public/quest-preload-manifest.json'
  const preloads = fs.existsSync(preloadPath)
    ? JSON.parse(fs.readFileSync(preloadPath, 'utf8'))
    : null
  if (preloads) {
    assert.equal(preloads.version, 1)
    assert.equal(preloads.mode, 'production')
    assert.equal(preloads.page, 'projects/quest')
    assert.ok(Array.isArray(preloads.assets) && preloads.assets.length <= 32)
    assert.equal(new Set(preloads.assets).size, preloads.assets.length)
    for (const url of preloads.assets)
      assert.ok(assets.some((asset) => asset.url === url))
  }
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
        assets,
        preloads
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

function summarize(
  root,
  { control = false, preload = false, select = false } = {}
) {
  control ||= preload || select
  const read = (file) =>
    JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'))
  const names = ['before-1', 'after-1', 'after-2', 'before-2']
  const rounds = names.map((name) => ({
    name,
    fixture: read(`${name}/fixture.json`),
    performance: read(`${name}/performance.json`)
  }))
  const ref = rounds[0]
  const provenance = select ? read('provenance.json') : null
  if (select) {
    assert.equal(provenance.beforeSourceSha, process.env.QUEST_BASELINE_SHA)
    assert.equal(
      provenance.afterSourceSha,
      process.env.SLIPWAY_QUEST_CAPTURE_TRIAL_SHA
    )
    assert.deepEqual(provenance.productionChanges, [selectPath])
    assert.notEqual(
      provenance.selectSourceSha256.before,
      provenance.selectSourceSha256.after
    )
  }
  const expectedSource = (name) =>
    preload || !name.startsWith('before')
      ? process.env.SLIPWAY_QUEST_CAPTURE_TRIAL_SHA
      : process.env.QUEST_BASELINE_SHA
  const preloadMode = (name) => (name.startsWith('before') ? 'off' : 'on')
  const staticAssets = (sample) =>
    sample.native.resources.filter((resource) =>
      /\.(js|css)$/.test(resource.name)
    )
  const assetIdentity = (assets, pathKey, bytesKey) =>
    assets
      .map((asset) => [asset[pathKey], asset[bytesKey]])
      .sort((a, b) => a[0].localeCompare(b[0]))
  const checkStaticAssets = (sample, expected) => {
    const resources = staticAssets(sample)
    assert.equal(
      new Set(resources.map((asset) => asset.name)).size,
      resources.length,
      'Preloading must not duplicate static requests'
    )
    assert.deepEqual(
      assetIdentity(resources, 'name', 'encodedBodySize'),
      expected,
      'Preload on/off must request identical static paths and encoded bytes'
    )
  }
  const median = (values) => {
    const s = [...values].sort((a, b) => a - b)
    return (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2
  }
  for (const round of rounds) {
    const expected = expectedSource(round.name)
    assert.equal(round.fixture.sourceSha, expected)
    if (control) assert.equal(round.fixture.phase, 'after')
    assert.equal(round.performance.sourceSha, expected)
    assert.equal(
      round.fixture.captureTrialSourceSha,
      process.env.SLIPWAY_QUEST_CAPTURE_TRIAL_SHA
    )
    assert.equal(round.performance.productionBenchmark, true)
    assert.equal(round.performance.measurementVersion, 2)
    if (select) {
      assert.equal(round.performance.phase, 'after')
      assert.equal(round.performance.preloadMode, 'on')
      assert.equal(
        round.performance.clockMode,
        'Date-only fixture; native Performance and timers'
      )
      assert.equal(
        round.performance.additionalReadiness,
        ref.performance.additionalReadiness
      )
      assert.equal(round.performance.productionBuild.sourceSha, expected)
      assert.equal(round.performance.productionBuild.buildMode, 'production')
      assert.equal(round.performance.productionBuild.applicationLifted, false)
      assert.ok(round.performance.productionBuild.preloads?.assets.length > 0)
      const sameSource = rounds.find(
        (entry) => entry.fixture.sourceSha === expected
      )
      assert.deepEqual(
        round.performance.productionBuild,
        sameSource.performance.productionBuild
      )
    }
    if (preload) {
      assert.equal(round.performance.preloadMode, preloadMode(round.name))
      const build = round.performance.productionBuild
      const referenceBuild = ref.performance.productionBuild
      assert.equal(build.sourceSha, expected)
      assert.equal(build.buildMode, 'production')
      assert.equal(build.preloads?.version, 1)
      assert.equal(build.preloads?.page, 'projects/quest')
      assert.equal(build.preloads?.mode, 'production')
      assert.ok(build.preloads.assets.length > 0)
      assert.deepEqual(build.preloads, referenceBuild.preloads)
      assert.deepEqual(build.manifest.entries, referenceBuild.manifest.entries)
      assert.deepEqual(
        assetIdentity(build.assets, 'url', 'bytes'),
        assetIdentity(referenceBuild.assets, 'url', 'bytes')
      )
    }
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
      if (select) {
        const referenceRow = ref.performance.measurements.find(
          (entry) => entry.capture === row.capture
        )
        for (const key of [
          'initialJsonBytes',
          'questJsonBytes',
          'documentElementCount'
        ])
          assert.equal(
            row[key],
            referenceRow[key],
            `${round.name}: ${row.capture}: unchanged ${key}`
          )
      }
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
        if (preload) {
          const referenceRow = ref.performance.measurements.find(
            (reference) => reference.capture === row.capture
          )
          checkStaticAssets(
            sample,
            assetIdentity(
              staticAssets(referenceRow.productionSamples[0]),
              'name',
              'encodedBodySize'
            )
          )
        }
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
    firstRouteAssetStartAfterResponseMs: (sample) =>
      Math.min(
        ...staticAssets(sample)
          .filter((asset) => asset.name.includes('/async/'))
          .map((asset) => asset.startTime)
      ) - sample.native.navigation.responseEnd,
    lastStaticAssetEndAfterResponseMs: (sample) =>
      Math.max(...staticAssets(sample).map((asset) => asset.responseEnd)) -
      sample.native.navigation.responseEnd,
    maxRouteAssetQueueMs: (sample) =>
      Math.max(
        ...staticAssets(sample)
          .filter((asset) => asset.name.includes('/async/'))
          .map((asset) => asset.requestStart - asset.startTime)
      ),
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
      for (const name of [
        'initialJsonBytes',
        'questJsonBytes',
        'documentBytes'
      ])
        result[phase][name] = median(rows.map((row) => row[name]))
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
    const expected = expectedSource(round.name)
    assert.equal(round.sourceSha, expected)
    if (preload) assert.equal(round.preloadMode, preloadMode(round.name))
    if (select) {
      assert.equal(round.preloadMode, 'on')
      assert.equal(round.method, actionRounds[0].method)
      assert.equal(round.fixture, actionRounds[0].fixture)
    }
    assert.equal(round.observations.length, 36)
    for (const row of round.observations) {
      assert.ok(
        Number.isFinite(row.native.elapsedMs) && row.native.elapsedMs <= 15000
      )
      assert.ok(row.geometry.horizontalOverflowPx <= 1)
      assert.ok(row.geometry.workspaceHorizontalOverflowPx <= 1)
      if (select && row.kind === 'job-click')
        assert.equal(
          staticAssets(row).length,
          0,
          'Select optimization must preserve the eager inspector'
        )
      if (preload) {
        const reference = actionRounds[0].observations.find(
          (entry) => entry.capture === row.capture && entry.kind === row.kind
        )
        checkStaticAssets(
          row,
          assetIdentity(staticAssets(reference), 'name', 'encodedBodySize')
        )
        if (row.kind === 'job-click')
          assert.equal(
            staticAssets(row).length,
            0,
            'First inspector click must remain eager in both modes'
          )
      }
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
        actionObservations.push({
          ...(control
            ? {
                phase: preload
                  ? `preload-${phase === 'before' ? 'off' : 'on'}`
                  : select
                  ? `select-${phase === 'before' ? 'unguarded' : 'guarded'}`
                  : phase === 'before'
                  ? 'pre-split'
                  : 'current'
              }
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
    comparison: preload
      ? 'same-source preload off versus on'
      : select
      ? 'current Quest UI: closed-Select measurement unguarded versus guarded'
      : control
      ? 'pre-split versus current'
      : 'old page versus current',
    beforeSourceSha: preload
      ? process.env.SLIPWAY_QUEST_CAPTURE_TRIAL_SHA
      : process.env.QUEST_BASELINE_SHA,
    afterSourceSha: process.env.SLIPWAY_QUEST_CAPTURE_TRIAL_SHA,
    observations,
    rounds,
    ...(select
      ? {
          selectControl: {
            beforeMode: 'unguarded',
            afterMode: 'guarded',
            order: ['unguarded', 'guarded', 'guarded', 'unguarded'],
            preloadMode: 'on',
            fixturePhase: 'after',
            provenance
          }
        }
      : {}),
    ...(preload
      ? {
          preloadControl: {
            beforeMode: 'off',
            afterMode: 'on',
            order: ['off', 'on', 'on', 'off'],
            adapter:
              'Disabled rounds strip only link[data-quest-preload="1"] from controlled initial HTML; source, JS/CSS assets, fixture and readiness remain identical',
            manifest: ref.performance.productionBuild.preloads
          }
        }
      : {}),
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
      'One executor, two rounds per phase; no production traffic or universal no-regression claim',
      ...(preload
        ? [
            'Same-source on/off isolates generated preload hints only; it does not remove the byte increase or establish non-regression against the original Quest page'
          ]
        : []),
      ...(select
        ? [
            'Two real current-UI source builds isolate the Select.vue guard; normal hashed asset differences remain visible in raw requests. The separate original-page comparison is still required.'
          ]
        : [])
    ]
  }
  const lines = [
    preload
      ? '## Quest same-source preload control: off versus on'
      : select
      ? '## Quest closed-Select control: initial and action costs'
      : control
      ? '## Quest pre-split control: initial and action costs'
      : '## Quest production-asset navigation observations',
    '',
    report.method,
    '',
    `Before: ${report.beforeSourceSha}`,
    `After: ${report.afterSourceSha}`,
    ...(preload
      ? [
          'Before = preload off; after = preload on. Identical source and production JS/CSS paths/bytes; only named generated HTML hints are removed in disabled rounds.'
        ]
      : []),
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
    preload
      ? '### Same-source preload off/on action costs'
      : select
      ? '### Same-runner unguarded and guarded Select action costs'
      : control
      ? '### Same-runner pre-split and current action costs'
      : '### After-only inspector and direct-navigation costs',
    '',
    preload
      ? 'Balanced off → on → on → off with the same current page and fixture. First inspector clicks remain eager with zero new static requests. Direct links retain identical requested static paths/bytes. The pinned original-page comparison remains separate.'
      : select
      ? 'Pinned pre-guard and exact proposed sources, both actual current Quest UI and after fixture; preload on throughout. Balanced unguarded → guarded → guarded → unguarded. Only Select.vue differs in production source; identical dependency versions, native readiness and Date-only clock. Six eager-inspector/direct-link samples per phase/path/view; raw values and requests remain in JSON.'
      : control
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
  else if (mode === 'summarize-preload')
    summarize(process.argv[3], { preload: true })
  else if (mode === 'summarize-select')
    summarize(process.argv[3], { select: true })
  else if (mode === 'select-provenance')
    selectProvenance(process.argv[3], process.argv[4], process.argv[5])
  else
    throw new Error(
      'Expected build, configure, summarize, summarize-control, summarize-preload, summarize-select, or select-provenance'
    )
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
