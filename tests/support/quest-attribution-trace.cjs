// Reconstructed diagnostic harness for issue #653 / PR #673. The lost original
// was never published; this is not a byte-for-byte recovery. Opt-in CI only.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const PREFIX = 'quest-attribution:'
const ROUND_NAMES = ['before-1', 'after-1', 'after-2', 'before-2']
const REQUIRED_CATEGORIES = ['devtools.timeline', 'blink.user_timing']
const OPTIONAL_CATEGORIES = [
  'loading',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.invalidationTracking',
  'disabled-by-default-devtools.timeline.stack',
  'disabled-by-default-v8.cpu_profiler'
]

// Passed by value to addInitScript. Keep this function self-contained, and do
// not read layout in the matcher or replace any timer / Performance method.
function installBrowserProbe(options) {
  'use strict'
  if (location.pathname !== options.projectPath) return
  const state = {
    reconstructed: true,
    wrapperInstalled: false,
    completed: false,
    counts: {},
    marks: [],
    errors: []
  }
  const nativeMark = performance.mark
  const next = (kind) =>
    state.completed
      ? state.counts[kind] || 0
      : (state.counts[kind] = (state.counts[kind] || 0) + 1)
  const mark = (kind, id, edge) => {
    if (state.completed) return
    const name = `quest-attribution:${kind}:${id}:${edge}`
    try {
      const entry = Reflect.apply(nativeMark, performance, [name])
      state.marks.push({ name, startTime: entry.startTime })
    } catch (error) {
      // A diagnostic failure invalidates the sample; it must never mask the
      // return value or exception of the operation being observed.
      state.errors.push(String(error))
    }
  }
  window.__questAttributionProbe = {
    state,
    next,
    mark,
    finish() {
      state.completed = true
    },
    readinessRects(element) {
      if (!element) return undefined
      const id = next('readiness')
      mark('readiness', id, 'begin')
      try {
        return element.getClientRects()
      } finally {
        mark('readiness', id, 'end')
      }
    }
  }
  const prototype = Element.prototype
  const descriptor = Object.getOwnPropertyDescriptor(
    prototype,
    'getBoundingClientRect'
  )
  const getAttribute = prototype.getAttribute
  if (!descriptor || typeof descriptor.value !== 'function') {
    state.errors.push('Missing native getBoundingClientRect descriptor')
    return
  }
  const original = descriptor.value
  function getBoundingClientRect() {
    if (state.completed) return Reflect.apply(original, this, arguments)
    let matches = false
    try {
      matches =
        Reflect.apply(getAttribute, this, ['data-slot']) === 'select-trigger' &&
        Reflect.apply(getAttribute, this, ['aria-label']) ===
          'Filter jobs by state'
    } catch {
      // Let the original method produce its own exact illegal-receiver error.
    }
    if (!matches) return Reflect.apply(original, this, arguments)
    const id = next('select')
    mark('select', id, 'begin')
    try {
      return Reflect.apply(original, this, arguments)
    } finally {
      mark('select', id, 'end')
    }
  }
  try {
    Object.defineProperty(prototype, 'getBoundingClientRect', {
      ...descriptor,
      value: getBoundingClientRect
    })
    state.wrapperInstalled = true
    mark('installed', 0, 'point')
  } catch (error) {
    state.errors.push(String(error))
  }
}

async function startTrace(cdp, directory, sample) {
  const { categories: supported } = await cdp.send('Tracing.getCategories')
  for (const category of REQUIRED_CATEGORIES)
    assert.ok(supported.includes(category), `Unsupported category: ${category}`)
  const categories = [
    ...REQUIRED_CATEGORIES,
    ...OPTIONAL_CATEGORIES.filter((category) => supported.includes(category))
  ]
  let completed
  const completion = new Promise((resolve) => {
    completed = resolve
    cdp.on('Tracing.tracingComplete', completed)
  })
  try {
    await cdp.send('Tracing.start', {
      transferMode: 'ReturnAsStream',
      streamFormat: 'json',
      streamCompression: 'none',
      traceConfig: {
        recordMode: 'recordAsMuchAsPossible',
        includedCategories: categories
      }
    })
  } catch (error) {
    cdp.off('Tracing.tracingComplete', completed)
    throw error
  }
  let stopped
  return {
    stop() {
      // Navigation failures and normal completion share one draining path.
      if (stopped) return stopped
      stopped = (async () => {
        let timeout
        try {
          const timeoutPromise = new Promise((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error('CDP trace completion timed out')),
              30000
            )
          })
          await cdp.send('Tracing.end')
          const result = await Promise.race([completion, timeoutPromise])
          assert.ok(result.stream, 'Complete CDP trace stream is required')
          const traceFile = `trace-${sample}.json`
          const metadataFile = `trace-${sample}.meta.json`
          fs.mkdirSync(directory, { recursive: true })
          const fd = fs.openSync(path.join(directory, traceFile), 'w')
          let bytes = 0
          try {
            let eof = false
            while (!eof) {
              const chunk = await cdp.send('IO.read', {
                handle: result.stream,
                size: 1024 * 1024
              })
              const buffer = Buffer.from(
                chunk.data,
                chunk.base64Encoded ? 'base64' : 'utf8'
              )
              fs.writeSync(fd, buffer)
              bytes += buffer.length
              eof = chunk.eof
            }
          } finally {
            fs.closeSync(fd)
            await cdp.send('IO.close', { handle: result.stream })
          }
          const metadata = {
            traceFile,
            metadataFile,
            bytes,
            dataLossOccurred: result.dataLossOccurred,
            categories,
            unsupportedOptionalCategories: OPTIONAL_CATEGORIES.filter(
              (category) => !supported.includes(category)
            ),
            transferMode: 'ReturnAsStream',
            recordMode: 'recordAsMuchAsPossible'
          }
          fs.writeFileSync(
            path.join(directory, metadataFile),
            JSON.stringify(metadata, null, 2) + '\n'
          )
          // Preserve the raw stream and metadata even if Chrome reports loss.
          assert.equal(
            result.dataLossOccurred,
            false,
            'Chrome trace must explicitly report dataLossOccurred=false'
          )
          return metadata
        } finally {
          clearTimeout(timeout)
          cdp.off('Tracing.tracingComplete', completed)
        }
      })()
      return stopped
    }
  }
}

const categoryIncludes = (event, category) =>
  String(event.cat || '')
    .split(',')
    .includes(category)
const navigationId = (event) =>
  event.args?.data?.navigationId ?? event.args?.navigationId
const frameId = (event) =>
  event.args?.frame ??
  event.args?.data?.frame ??
  event.args?.beginData?.frame ??
  event.args?.frameId
const sameThread = (a, b) => a.pid === b.pid && a.tid === b.tid
const isFlush = (event) =>
  ['UpdateLayoutTree', 'RecalculateStyles', 'Layout'].includes(event.name)

// Normalize complete events and synchronous B/E pairs. Async slices are not
// synchronous layout work. Preserve the original args, stack, frame and times.
function completeEvents(events) {
  const stacks = new Map()
  const complete = []
  for (const event of [...events].sort((a, b) => a.ts - b.ts)) {
    if (event.ph === 'X') complete.push(event)
    else if (event.ph === 'B') {
      const key = `${event.pid}:${event.tid}`
      if (!stacks.has(key)) stacks.set(key, [])
      stacks.get(key).push(event)
    } else if (event.ph === 'E') {
      const begin = stacks.get(`${event.pid}:${event.tid}`)?.pop()
      if (begin) {
        assert.ok(
          !event.name || event.name === begin.name,
          'Mismatched synchronous trace boundaries'
        )
        complete.push({
          ...begin,
          ph: 'X',
          dur: event.ts - begin.ts,
          args: { ...begin.args, ...event.args }
        })
      }
    }
  }
  for (const stack of stacks.values())
    assert.ok(!stack.some(isFlush), 'Incomplete style/layout trace event')
  return complete
}

function analyzeTrace(trace, sample) {
  try {
    return analyzeValidTrace(trace, sample)
  } catch (error) {
    return { status: 'invalid', reason: error.message, firstSelect: null }
  }
}

function analyzeValidTrace(trace, sample) {
  assert.equal(
    sample.trace.dataLossOccurred,
    false,
    'Trace loss or missing completion status'
  )
  for (const category of REQUIRED_CATEGORIES)
    assert.ok(
      sample.trace.categories.includes(category),
      `Missing required trace category: ${category}`
    )
  const events = Array.isArray(trace) ? trace : trace.traceEvents
  assert.ok(Array.isArray(events) && events.length, 'Missing full trace events')
  const native = sample.native
  const probe = native.attribution
  assert.equal(
    probe?.wrapperInstalled,
    true,
    'Geometry wrapper was not installed'
  )
  assert.equal(
    probe.completed,
    true,
    'Probe inventory was not closed at native ready'
  )
  assert.deepEqual(probe.errors, [], 'Browser probe errors')
  assert.ok(probe.marks.length, 'Browser marker inventory is missing')
  const markers = events.filter(
    (event) =>
      categoryIncludes(event, 'blink.user_timing') &&
      (event.name?.startsWith(PREFIX) ||
        ['quest-native-content-ready', 'quest-native-ready'].includes(
          event.name
        ))
  )
  const oneMark = (name) => {
    const matches = markers.filter((event) => event.name === name)
    assert.equal(matches.length, 1, `Missing or duplicate marker: ${name}`)
    assert.ok(
      ['I', 'i', 'R'].includes(matches[0].ph),
      `Not an instantaneous user timing marker: ${name}`
    )
    assert.ok(
      Number.isFinite(matches[0].ts),
      `Missing Chrome timestamp: ${name}`
    )
    assert.ok(
      Number.isSafeInteger(matches[0].pid) &&
        Number.isSafeInteger(matches[0].tid),
      `Missing Chrome process/thread: ${name}`
    )
    return matches[0]
  }
  const installed = oneMark(`${PREFIX}installed:0:point`)
  const content = oneMark('quest-native-content-ready')
  const ready = oneMark('quest-native-ready')
  const navId = navigationId(installed)
  assert.ok(navId, 'Install mark lacks Chrome navigationId')
  // Chrome user marks identify a document by navigationId, not necessarily by
  // frame. Join to navigationStart, then require the same renderer thread.
  // Source: chromium/core/timing/performance_user_timing.cc and
  // chromium/core/loader/document_load_timing.cc (not rounded web timestamps).
  const navigations = events.filter(
    (event) =>
      event.name === 'navigationStart' &&
      navigationId(event) === navId &&
      event.pid === installed.pid
  )
  assert.equal(
    navigations.length,
    1,
    'Missing or ambiguous navigation/frame correspondence'
  )
  const navigation = navigations[0]
  const frame = frameId(navigation)
  assert.ok(
    frame && frame === sample.frameId,
    'Trace navigation does not match the captured main frame'
  )
  assert.ok(
    sameThread(navigation, installed),
    'Navigation and probe are on different renderer threads'
  )
  assert.ok(
    navigation.ts <= installed.ts &&
      installed.ts <= content.ts &&
      content.ts <= ready.ts,
    'Invalid native readiness ordering'
  )
  const inventory = new Map(probe.marks.map((mark) => [mark.name, mark]))
  assert.equal(
    inventory.size,
    probe.marks.length,
    'Duplicate browser marker names'
  )
  assert.equal(
    markers.filter((event) => event.name.startsWith(PREFIX)).length,
    inventory.size,
    'Trace/browser marker inventory mismatch'
  )
  for (const event of markers) {
    assert.ok(
      sameThread(event, installed),
      `Marker thread mismatch: ${event.name}`
    )
    assert.equal(
      navigationId(event),
      navId,
      `Marker navigation mismatch: ${event.name}`
    )
    if (frameId(event))
      assert.equal(
        frameId(event),
        frame,
        `Marker frame mismatch: ${event.name}`
      )
    if (event.name.startsWith(PREFIX)) {
      const browserMark = inventory.get(event.name)
      assert.ok(browserMark, `Unrecorded marker: ${event.name}`)
      assert.ok(
        Number.isFinite(browserMark.startTime),
        `Missing browser marker timestamp: ${event.name}`
      )
      // Chrome trace JSON serializes this auxiliary millisecond value with
      // 16 significant digits (observed CI: 125.2000000000116 versus the
      // browser snapshot's 125.20000000001164). Accept that exact decimal
      // serialization only; raw Chrome ts drives every ordering/nesting test.
      const traceStartTime = event.args?.data?.startTime
      assert.ok(
        traceStartTime === browserMark.startTime ||
          traceStartTime === Number(browserMark.startTime.toPrecision(16)),
        `Marker timestamp correspondence mismatch: ${event.name}`
      )
    }
  }
  const interval = (kind, id) => {
    const begin = oneMark(`${PREFIX}${kind}:${id}:begin`)
    const end = oneMark(`${PREFIX}${kind}:${id}:end`)
    assert.ok(begin.ts <= end.ts, `Reversed ${kind} markers`)
    return {
      kind,
      id,
      beginUs: begin.ts,
      endUs: end.ts,
      pid: begin.pid,
      tid: begin.tid,
      frame
    }
  }
  const intervals = (kind) => {
    const count = probe.counts[kind] || 0
    assert.ok(
      Number.isSafeInteger(count) && count >= 0,
      `Invalid ${kind} marker count`
    )
    const result = Array.from({ length: count }, (_, index) =>
      interval(kind, index + 1)
    )
    assert.equal(
      markers.filter((event) => event.name.startsWith(`${PREFIX}${kind}:`))
        .length,
      count * 2,
      `Unexpected ${kind} markers`
    )
    for (let index = 1; index < result.length; index++)
      assert.ok(
        result[index - 1].beginUs <= result[index].beginUs,
        `Unordered ${kind} markers`
      )
    return result
  }
  const selects = intervals('select')
  const readiness = intervals('readiness')
  assert.ok(readiness.length, 'Missing readiness geometry markers')
  assert.ok(
    Number.isSafeInteger(probe.counts.sse) && probe.counts.sse > 0,
    'Missing SSE stream markers'
  )
  const streams = Array.from({ length: probe.counts.sse }, (_, index) => {
    const id = index + 1
    const registration = interval('sse-register', id)
    const callback = interval('sse-callback', id)
    const open = interval('sse-open', id)
    const message = interval('sse-message', id)
    assert.ok(
      registration.endUs <= callback.beginUs &&
        callback.beginUs <= open.beginUs &&
        open.endUs <= message.beginUs &&
        message.endUs <= callback.endUs,
      'Invalid SSE scheduling or dispatch order'
    )
    return {
      id,
      registration,
      callback,
      open,
      message,
      timerWaitUs: callback.beginUs - registration.endUs
    }
  })
  const fcps = events.filter(
    (event) =>
      event.name === 'firstContentfulPaint' &&
      frameId(event) === frame &&
      event.pid === installed.pid &&
      (!navigationId(event) || navigationId(event) === navId) &&
      event.ts >= navigation.ts &&
      event.ts <= ready.ts
  )
  assert.equal(
    fcps.length,
    1,
    'Missing or ambiguous main-frame FCP presentation event'
  )
  const fcp = fcps[0]
  assert.ok(
    sameThread(fcp, installed),
    'FCP belongs to another renderer thread'
  )
  const rawFlushes = completeEvents(events).filter(
    (event) =>
      isFlush(event) &&
      categoryIncludes(event, 'devtools.timeline') &&
      sameThread(event, installed) &&
      event.ts >= navigation.ts &&
      event.ts <= ready.ts
  )
  for (const event of rawFlushes) {
    assert.ok(
      Number.isFinite(event.dur) && event.dur >= 0,
      'Invalid style/layout duration'
    )
    assert.ok(frameId(event), `Missing frame correspondence for ${event.name}`)
  }
  const flushes = rawFlushes
    .filter((event) => frameId(event) === frame)
    .map((event) => ({
      name: event.name,
      beginUs: event.ts,
      endUs: event.ts + event.dur,
      durationUs: event.dur,
      pid: event.pid,
      tid: event.tid,
      frame,
      args: event.args
    }))
  const inside = (event, region) =>
    event.beginUs >= region.beginUs && event.endUs <= region.endUs
  const overlap = (a, b) => a.beginUs < b.endUs && a.endUs > b.beginUs
  const readinessFlushes = flushes.filter((event) =>
    readiness.some((region) => inside(event, region))
  )
  const firstSelect = selects[0] || null
  const nested = firstSelect
    ? flushes.filter(
        (event) => event.durationUs > 0 && inside(event, firstSelect)
      )
    : []
  const later = firstSelect
    ? flushes.filter(
        (event) =>
          event.durationUs > 0 &&
          event.beginUs >= firstSelect.endUs &&
          event.endUs <= fcp.ts &&
          !readiness.some((region) => overlap(event, region))
      )
    : []
  const duplicatedKinds = [
    ...new Set(nested.map((event) => event.name))
  ].filter((name) => later.some((event) => event.name === name))
  let reason
  let status
  if (!firstSelect) {
    assert.equal(sample.phase, 'before', 'Head sample has no first Select read')
    assert.equal(native.filterPresent, false, 'Unmarked filter in baseline')
    status = 'not-applicable'
    reason = 'Original page has no filter Select; firstSelect is null'
  } else if (firstSelect.endUs >= fcp.ts) {
    status = 'rejected'
    reason = 'First Select read is not wholly before FCP presentation'
  } else if (!nested.length) {
    status = 'rejected'
    reason =
      'No synchronous style/layout flush nested inside the first Select read'
  } else if (!duplicatedKinds.length) {
    status = 'rejected'
    reason =
      'No later duplicate style/layout flush before FCP outside the readiness read'
  } else {
    status = 'supported'
    reason =
      'Synchronous flush inside first Select read and same-kind later flush before FCP; readiness flushes are reported separately'
  }
  const nativePaint = native.paints?.find(
    (entry) => entry.name === 'first-contentful-paint'
  )
  return {
    status,
    reason,
    navigation: {
      timestampUs: navigation.ts,
      navigationId: navId,
      frame,
      pid: installed.pid,
      tid: installed.tid
    },
    firstSelect,
    selects,
    nestedSelectFlushes: nested,
    laterDuplicateFlushes: later.filter((event) =>
      duplicatedKinds.includes(event.name)
    ),
    readinessReads: readiness,
    readinessFlushes,
    allMainFrameFlushes: flushes,
    streams,
    contentReadyUs: content.ts,
    readyUs: ready.ts,
    fcp: {
      tracePresentationUs: fcp.ts,
      presentationSinceNavigationMs: (fcp.ts - navigation.ts) / 1000,
      nativeEntryStartTimeMs: nativePaint?.startTime ?? null,
      nativePaintTimeMs: nativePaint?.paintTime ?? null,
      nativePresentationTimeMs: nativePaint?.presentationTime ?? null,
      distinction:
        'Trace FCP is presentation time. Native paintTime (when exposed) is a different field; web timestamps are not used to assign trace nesting.'
    },
    caveat:
      'Mechanism evidence only. Instrumentation perturbs execution; this is not a causal speedup or uninstrumented production/preload measurement.'
  }
}

function validateRounds(rounds) {
  assert.deepEqual(
    rounds.map((round) => round.name),
    ROUND_NAMES,
    'Expected original-head-head-original (ABBA) round order'
  )
  const samples = []
  const reference = rounds[0]
  for (const round of rounds) {
    const phase = round.name.startsWith('before') ? 'before' : 'after'
    assert.equal(round.report.phase, phase)
    assert.equal(round.fixture.phase, phase)
    assert.equal(round.report.reconstructed, true)
    assert.equal(round.report.productionBenchmark, true)
    assert.equal(
      round.report.samples.length,
      5,
      'Each ABBA round must preserve five raw samples'
    )
    assert.equal(round.report.sourceSha, round.fixture.sourceSha)
    const expected =
      phase === 'before'
        ? process.env.QUEST_BASELINE_SHA
        : process.env.SLIPWAY_QUEST_CAPTURE_TRIAL_SHA
    if (expected) assert.equal(round.report.sourceSha, expected)
    for (const key of [
      'captures',
      'jobs',
      'events',
      'frozenBrowserTime',
      'project',
      'team',
      'user',
      'environment',
      'captureTrialSourceSha'
    ])
      assert.deepEqual(
        round.fixture[key],
        reference.fixture[key],
        `Fixture mismatch: ${key}`
      )
    for (const [index, sample] of round.report.samples.entries()) {
      assert.equal(sample.sample, index)
      assert.equal(sample.capture, 'desktop-light')
      assert.equal(sample.phase, phase)
      assert.equal(sample.sourceSha, round.report.sourceSha)
      assert.ok(sample.trace.traceFile && sample.trace.metadataFile)
      samples.push({ round: round.name, ...sample })
    }
  }
  assert.equal(
    samples.length,
    20,
    'Exactly twenty raw navigation samples are required'
  )
  for (const phase of ['before', 'after']) {
    const shas = new Set(
      samples
        .filter((sample) => sample.phase === phase)
        .map((sample) => sample.sourceSha)
    )
    assert.equal(shas.size, 1, `${phase} source changed across rounds`)
  }
  return samples
}

function summarize(directory) {
  const read = (file) =>
    JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'))
  let summary
  try {
    const rounds = ROUND_NAMES.map((name) => ({
      name,
      fixture: read(`${name}/fixture.json`),
      report: read(`${name}/attribution.json`)
    }))
    const samples = validateRounds(rounds).map((sample) => {
      const metadata = read(`${sample.round}/${sample.trace.metadataFile}`)
      assert.deepEqual(
        metadata,
        sample.trace,
        'Trace completion metadata changed'
      )
      const file = path.join(directory, sample.round, sample.trace.traceFile)
      assert.equal(
        fs.statSync(file).size,
        metadata.bytes,
        'Full raw trace is missing or truncated'
      )
      return {
        ...sample,
        analysis: analyzeTrace(
          JSON.parse(fs.readFileSync(file, 'utf8')),
          sample
        )
      }
    })
    const head = samples.filter((sample) => sample.phase === 'after')
    const invalid = samples.filter(
      (sample) => sample.analysis.status === 'invalid'
    )
    const support = head.filter(
      (sample) => sample.analysis.status === 'supported'
    ).length
    summary = {
      reconstructed: true,
      status: invalid.length
        ? 'invalid'
        : support === head.length
        ? 'supported'
        : support === 0
        ? 'rejected'
        : 'mixed',
      rawSampleCount: samples.length,
      headSupportingSamples: support,
      headSampleCount: head.length,
      invalidSamples: invalid.map((sample) => ({
        round: sample.round,
        sample: sample.sample,
        reason: sample.analysis.reason
      })),
      samples,
      limitations: [
        'This harness reconstructs an unpublished lost diagnostic; no original result is recovered.',
        'Twenty instrumented desktop-light navigations in original-head-head-original rounds; production assets, original fixture/readiness/SSE scheduling retained.',
        'A same-kind later flush is temporal mechanism evidence, not proof that the first read caused it or that removing it speeds up the page.',
        'Full raw traces and samples are retained separately from uninstrumented production and preload reports.'
      ]
    }
  } catch (error) {
    summary = { reconstructed: true, status: 'invalid', reason: error.message }
  }
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(
    path.join(directory, 'attribution-summary.json'),
    JSON.stringify(summary, null, 2) + '\n'
  )
  const text = `Quest attribution (reconstructed): ${summary.status}\n${
    summary.reason ||
    `${summary.headSupportingSamples}/${summary.headSampleCount} head samples support the specific mechanism; ${summary.rawSampleCount} raw samples preserved; ${summary.invalidSamples.length} invalid samples.`
  }\nMechanism evidence is not a causal speedup claim. See attribution-summary.json and complete per-sample Chrome traces.\n`
  fs.writeFileSync(path.join(directory, 'attribution-summary.txt'), text)
  if (process.env.GITHUB_STEP_SUMMARY)
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text)
  console.log(text)
  return summary
}

module.exports = {
  installBrowserProbe,
  startTrace,
  analyzeTrace,
  validateRounds,
  summarize,
  completeEvents,
  REQUIRED_CATEGORIES,
  OPTIONAL_CATEGORIES
}
if (require.main === module) {
  const summary = summarize(process.argv[2] || 'quest-attribution')
  if (summary.status === 'invalid') process.exitCode = 1
}
