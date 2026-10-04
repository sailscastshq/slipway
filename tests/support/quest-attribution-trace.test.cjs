const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const {
  installBrowserProbe,
  startTrace,
  analyzeTrace,
  validateRounds,
  completeEvents,
  REQUIRED_CATEGORIES,
  OPTIONAL_CATEGORIES
} = require('./quest-attribution-trace.cjs')

const PROJECT_PATH = '/projects/quest-attribution'
const PREFIX = 'quest-attribution:'
const FRAME = 'main-frame-653'
const NAVIGATION = 'navigation-673'
const PID = 456
const TID = 789
const NAVIGATION_US = 1000000

function browserFixture(options = {}) {
  const calls = { attributes: [], bounds: [], rects: [], marks: [] }
  const illegalReceiver = new TypeError('Illegal invocation')
  const boundsResult = { x: 1, y: 2, width: 100, height: 40 }
  const rectsResult = [{ width: 100, height: 40 }]
  class Element {
    constructor(attributes = {}) {
      this.attributes = attributes
    }
    getAttribute(name) {
      if (!(this instanceof Element)) throw illegalReceiver
      calls.attributes.push({ receiver: this, name })
      return this.attributes[name] ?? null
    }
    getClientRects(...args) {
      calls.rects.push({ receiver: this, args })
      if (options.rectsError) throw options.rectsError
      return rectsResult
    }
  }
  const original = function (...args) {
    calls.bounds.push({ receiver: this, args })
    if (!(this instanceof Element)) throw illegalReceiver
    if (options.boundsError) throw options.boundsError
    return boundsResult
  }
  Object.defineProperty(Element.prototype, 'getBoundingClientRect', {
    value: original,
    configurable: options.configurable ?? true,
    writable: options.writable ?? false,
    enumerable: true
  })
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    Element.prototype,
    'getBoundingClientRect'
  )
  const performance = {
    mark(name) {
      assert.equal(this, performance)
      calls.marks.push(name)
      if (options.markError) throw options.markError
      return { name, startTime: calls.marks.length + 0.123456789 }
    }
  }
  const sandbox = {
    window: {},
    Element,
    performance,
    location: { pathname: options.pathname ?? PROJECT_PATH },
    options: { projectPath: PROJECT_PATH }
  }
  // addInitScript serializes this function, so deliberately provide no module
  // scope, Node globals, PREFIX constant, or imported helper to the VM.
  if (!options.skipInstall)
    vm.runInNewContext(`(${installBrowserProbe.toString()})(options)`, sandbox)
  return {
    calls,
    Element,
    original,
    originalDescriptor,
    illegalReceiver,
    boundsResult,
    rectsResult,
    performance,
    sandbox,
    probe: sandbox.window.__questAttributionProbe
  }
}

function selectElement(browser, attributes = {}) {
  return new browser.Element({
    'data-slot': 'select-trigger',
    'aria-label': 'Filter jobs by state',
    ...attributes
  })
}

test('serialized probe preserves the native receiver, arguments, result, and descriptor flags', () => {
  const browser = browserFixture()
  const target = selectElement(browser)
  const argument = { preserved: true }
  const result = target.getBoundingClientRect(argument, 17)
  const descriptor = Object.getOwnPropertyDescriptor(
    browser.Element.prototype,
    'getBoundingClientRect'
  )

  assert.equal(result, browser.boundsResult)
  assert.equal(browser.probe.state.wrapperInstalled, true)
  assert.notEqual(descriptor.value, browser.original)
  for (const flag of ['configurable', 'enumerable', 'writable'])
    assert.equal(descriptor[flag], browser.originalDescriptor[flag])
  assert.equal(browser.calls.bounds.length, 1)
  assert.equal(browser.calls.bounds[0].receiver, target)
  assert.deepEqual(browser.calls.bounds[0].args, [argument, 17])
  assert.deepEqual(browser.calls.marks, [
    `${PREFIX}installed:0:point`,
    `${PREFIX}select:1:begin`,
    `${PREFIX}select:1:end`
  ])
  assert.equal(browser.probe.state.marks[1].startTime, 2.123456789)
  assert.equal(browser.probe.state.errors.length, 0)
})

test('probe marks only the exact Select target without performing extra geometry reads', () => {
  const browser = browserFixture()
  const elements = [
    new browser.Element(),
    selectElement(browser, { 'data-slot': 'button' }),
    selectElement(browser, { 'aria-label': 'Filter jobs by queue' }),
    selectElement(browser, { 'aria-label': 'Filter jobs by state ' }),
    selectElement(browser)
  ]
  for (const element of elements) {
    for (const property of ['offsetWidth', 'offsetHeight', 'clientWidth']) {
      Object.defineProperty(element, property, {
        get() {
          assert.fail(`Matcher unexpectedly read ${property}`)
        }
      })
    }
    assert.equal(element.getBoundingClientRect(), browser.boundsResult)
  }

  assert.equal(browser.calls.bounds.length, elements.length)
  assert.equal(browser.calls.rects.length, 0)
  assert.equal(browser.probe.state.counts.select, 1)
  assert.equal(browser.calls.marks.length, 3)
  assert.equal(browser.calls.attributes.length, 8)
})

test('probe preserves the exact native exception and closes the Select interval', () => {
  const nativeError = new Error('Native layout failed')
  const browser = browserFixture({ boundsError: nativeError })
  assert.throws(
    () => selectElement(browser).getBoundingClientRect(),
    (error) => error === nativeError
  )
  assert.equal(browser.calls.bounds.length, 1)
  assert.equal(browser.calls.marks.at(-1), `${PREFIX}select:1:end`)
})

test('probe lets the native method produce its exact illegal-receiver exception', () => {
  const browser = browserFixture()
  const receiver = {}
  assert.throws(
    () =>
      browser.Element.prototype.getBoundingClientRect.call(
        receiver,
        'argument'
      ),
    (error) => error === browser.illegalReceiver
  )
  assert.equal(browser.calls.bounds.length, 1)
  assert.equal(browser.calls.bounds[0].receiver, receiver)
  assert.deepEqual(browser.calls.bounds[0].args, ['argument'])
  assert.deepEqual(browser.calls.marks, [`${PREFIX}installed:0:point`])
})

test('failed instrumentation does not mask a native return value or exception', () => {
  const markError = new Error('Performance mark unavailable')
  for (const boundsError of [undefined, new Error('Native failure')]) {
    const browser = browserFixture({ markError, boundsError })
    const operation = () => selectElement(browser).getBoundingClientRect()
    if (boundsError) assert.throws(operation, (error) => error === boundsError)
    else assert.equal(operation(), browser.boundsResult)
    assert.equal(browser.calls.bounds.length, 1)
    assert.equal(browser.probe.state.errors.length, 3)
    assert.equal(browser.probe.state.marks.length, 0)
  }
})

test('readiness reads getClientRects exactly once and records a separate interval', () => {
  const browser = browserFixture()
  const target = selectElement(browser)
  assert.equal(browser.probe.readinessRects(null), undefined)
  assert.equal(browser.probe.readinessRects(target), browser.rectsResult)
  assert.equal(browser.calls.rects.length, 1)
  assert.equal(browser.calls.rects[0].receiver, target)
  assert.deepEqual(browser.calls.rects[0].args, [])
  assert.equal(browser.calls.bounds.length, 0)
  assert.equal(browser.calls.attributes.length, 0)
  assert.equal(browser.probe.state.counts.readiness, 1)
  assert.equal(browser.probe.state.counts.select, undefined)
  assert.deepEqual(browser.calls.marks, [
    `${PREFIX}installed:0:point`,
    `${PREFIX}readiness:1:begin`,
    `${PREFIX}readiness:1:end`
  ])
})

test('readiness closes its interval and preserves the native exception when marking fails', () => {
  const nativeError = new Error('Native client rects failed')
  const browser = browserFixture({
    rectsError: nativeError,
    markError: new Error('Cannot mark')
  })
  assert.throws(
    () => browser.probe.readinessRects(new browser.Element()),
    (error) => error === nativeError
  )
  assert.equal(browser.calls.rects.length, 1)
  assert.equal(browser.calls.marks.at(-1), `${PREFIX}readiness:1:end`)
  assert.equal(browser.probe.state.errors.length, 3)
})

test('probe leaves unrelated paths untouched and reports a non-replaceable descriptor', () => {
  const unrelated = browserFixture({ pathname: `${PROJECT_PATH}/other` })
  assert.equal(unrelated.probe, undefined)
  assert.equal(
    unrelated.Element.prototype.getBoundingClientRect,
    unrelated.original
  )
  assert.equal(unrelated.calls.marks.length, 0)

  const locked = browserFixture({ configurable: false, writable: false })
  assert.equal(locked.probe.state.wrapperInstalled, false)
  assert.equal(locked.probe.state.errors.length, 1)
  assert.equal(locked.Element.prototype.getBoundingClientRect, locked.original)
})

test('finish freezes marker inventory and counters while preserving subsequent native geometry calls', () => {
  const browser = browserFixture()
  const target = selectElement(browser)
  target.getBoundingClientRect()
  browser.probe.finish()
  const inventory = JSON.stringify(browser.probe.state)
  const attributesBefore = browser.calls.attributes.length
  assert.equal(browser.probe.state.completed, true)
  assert.equal(
    target.getBoundingClientRect('after-ready'),
    browser.boundsResult
  )
  assert.equal(browser.probe.readinessRects(target), browser.rectsResult)
  assert.equal(browser.probe.next('select'), 1)
  assert.equal(browser.probe.next('sse'), 0)
  browser.probe.mark('sse-register', 2, 'begin')
  browser.probe.finish()
  assert.equal(JSON.stringify(browser.probe.state), inventory)
  assert.equal(browser.calls.attributes.length, attributesBefore)
  assert.equal(browser.calls.bounds.length, 2)
  assert.deepEqual(browser.calls.bounds[1].args, ['after-ready'])
  assert.equal(browser.calls.rects.length, 1)
})

function chromeFixture({ phase = 'after', pairedFlushes = false } = {}) {
  const events = []
  const marks = []
  const counts = { select: phase === 'after' ? 1 : 0, readiness: 1, sse: 1 }
  const emit = (name, offset, extra = {}) => {
    const event = {
      name,
      cat: 'blink.user_timing',
      ph: 'I',
      s: 't',
      pid: PID,
      tid: TID,
      ts: NAVIGATION_US + offset,
      ...extra
    }
    events.push(event)
    return event
  }
  const mark = (name, offset) => {
    // Chrome's exact entry.startTime is not a rounded web performance.now()
    // timestamp. User marks need not carry a frame ID of their own.
    const startTime = offset / 1000 + 0.000123456789
    const event = emit(name, offset, {
      args: { data: { navigationId: NAVIGATION, startTime } }
    })
    if (name.startsWith(PREFIX)) marks.push({ name, startTime })
    return event
  }
  const region = (kind, begin, end) => {
    mark(`${PREFIX}${kind}:1:begin`, begin)
    mark(`${PREFIX}${kind}:1:end`, end)
  }
  const flush = (name, offset, dur) => {
    const args =
      name === 'Layout'
        ? {
            beginData: { frame: FRAME, dirtyObjects: 2, totalObjects: 14 },
            endData: { layoutRoots: [] }
          }
        : {
            data: {
              frame: FRAME,
              elementCount: 14,
              stackTrace: [
                {
                  functionName: 'getBoundingClientRect',
                  url: 'https://example.test/quest.js',
                  lineNumber: 65,
                  columnNumber: 3
                }
              ]
            }
          }
    const begin = emit(name, offset, {
      cat: 'devtools.timeline',
      ph: pairedFlushes ? 'B' : 'X',
      args
    })
    delete begin.s
    if (pairedFlushes) {
      const end = emit(name, offset + dur, {
        cat: 'devtools.timeline',
        ph: 'E',
        args: { finish: true }
      })
      delete end.s
    } else begin.dur = dur
  }
  emit('navigationStart', 0, {
    cat: 'blink.user_timing,loading',
    ph: 'R',
    args: {
      frame: FRAME,
      data: {
        navigationId: NAVIGATION,
        documentLoaderURL: 'https://example.test/projects/quest-attribution',
        isLoadingMainFrame: true,
        isOutermostMainFrame: true
      }
    }
  })
  mark(`${PREFIX}installed:0:point`, 100)
  region('sse-register', 200, 210)
  region('sse-callback', 800, 900)
  region('sse-open', 810, 820)
  region('sse-message', 830, 840)
  if (phase === 'after') {
    region('select', 1100, 1200)
    flush('UpdateLayoutTree', 1110, 30)
    flush('Layout', 1150, 30)
  }
  flush('UpdateLayoutTree', 1500, 30)
  flush('Layout', 1550, 30)
  region('readiness', 1800, 1900)
  flush('UpdateLayoutTree', 1810, 20)
  flush('Layout', 1850, 20)
  mark('quest-native-content-ready', 2000)
  emit('firstContentfulPaint', 2500, {
    cat: 'loading,rail,devtools.timeline',
    ph: 'R',
    args: { frame: FRAME, data: { navigationId: NAVIGATION } }
  })
  mark('quest-native-ready', 3000)
  return {
    trace: { traceEvents: events },
    sample: {
      phase,
      frameId: FRAME,
      trace: { dataLossOccurred: false, categories: [...REQUIRED_CATEGORIES] },
      native: {
        filterPresent: phase === 'after',
        paints: [
          {
            name: 'first-contentful-paint',
            startTime: 2.5,
            paintTime: 2.25,
            presentationTime: 2.5
          }
        ],
        attribution: {
          wrapperInstalled: true,
          completed: true,
          counts,
          marks,
          errors: []
        }
      }
    }
  }
}

const findEvent = (fixture, name) =>
  fixture.trace.traceEvents.find((event) => event.name === name)
const analyze = (fixture) => analyzeTrace(fixture.trace, fixture.sample)
const removeEvents = (fixture, predicate) => {
  fixture.trace.traceEvents = fixture.trace.traceEvents.filter(
    (event) => !predicate(event)
  )
}
const isStyleOrLayout = (event) =>
  ['UpdateLayoutTree', 'RecalculateStyles', 'Layout'].includes(event.name)

for (const pairedFlushes of [false, true]) {
  test(`Chrome ${
    pairedFlushes ? 'B/E' : 'X'
  } events support nested Select and later same-kind flush attribution`, () => {
    const fixture = chromeFixture({ pairedFlushes })
    const result = analyze(fixture)
    assert.equal(result.status, 'supported', result.reason)
    assert.deepEqual(result.navigation, {
      timestampUs: NAVIGATION_US,
      navigationId: NAVIGATION,
      frame: FRAME,
      pid: PID,
      tid: TID
    })
    assert.equal(result.firstSelect.beginUs, NAVIGATION_US + 1100)
    assert.equal(result.firstSelect.endUs, NAVIGATION_US + 1200)
    assert.deepEqual(
      result.nestedSelectFlushes.map((event) => event.name),
      ['UpdateLayoutTree', 'Layout']
    )
    assert.deepEqual(
      result.laterDuplicateFlushes.map((event) => event.beginUs),
      [NAVIGATION_US + 1500, NAVIGATION_US + 1550]
    )
    assert.deepEqual(
      result.readinessFlushes.map((event) => event.beginUs),
      [NAVIGATION_US + 1810, NAVIGATION_US + 1850]
    )
    assert.equal(result.allMainFrameFlushes.length, 6)
    assert.equal(result.streams[0].timerWaitUs, 590)
    assert.equal(
      result.nestedSelectFlushes[0].args.data.stackTrace[0].functionName,
      'getBoundingClientRect'
    )
    assert.equal(result.nestedSelectFlushes[1].args.beginData.frame, FRAME)
    assert.equal(result.nestedSelectFlushes[0].durationUs, 30)
    if (pairedFlushes)
      assert.equal(result.nestedSelectFlushes[0].args.finish, true)
    assert.equal(result.fcp.tracePresentationUs, NAVIGATION_US + 2500)
    assert.equal(result.fcp.presentationSinceNavigationMs, 2.5)
    assert.equal(result.fcp.nativePaintTimeMs, 2.25)
    assert.equal(result.fcp.nativePresentationTimeMs, 2.5)
    assert.match(result.caveat, /not a causal speedup/)
  })
}

test('parser joins Chrome navigation IDs to navigationStart.frame without requiring frames on marks', () => {
  const fixture = chromeFixture()
  assert.equal(
    findEvent(fixture, `${PREFIX}installed:0:point`).args.frame,
    undefined
  )
  assert.equal(analyze(fixture).status, 'supported')
  fixture.sample.native.paints[0] = {
    name: 'first-contentful-paint',
    startTime: -1000,
    paintTime: 9999,
    presentationTime: 8888
  }
  // Native paint fields are reported separately and cannot establish nesting.
  const result = analyzeTrace(fixture.trace.traceEvents, fixture.sample)
  assert.equal(result.status, 'supported')
  assert.equal(result.fcp.nativeEntryStartTimeMs, -1000)
  assert.equal(result.fcp.tracePresentationUs, NAVIGATION_US + 2500)
})

test('parser supports RecalculateStyles as same-kind synchronous style work', () => {
  const fixture = chromeFixture()
  for (const event of fixture.trace.traceEvents)
    if (event.name === 'UpdateLayoutTree') event.name = 'RecalculateStyles'
  const result = analyze(fixture)
  assert.equal(result.status, 'supported')
  assert.equal(result.nestedSelectFlushes[0].name, 'RecalculateStyles')
})

test('parser rejects a first Select read with no nested synchronous flush', () => {
  const fixture = chromeFixture()
  removeEvents(
    fixture,
    (event) => isStyleOrLayout(event) && event.ts < NAVIGATION_US + 1200
  )
  const result = analyze(fixture)
  assert.equal(result.status, 'rejected')
  assert.match(result.reason, /No synchronous style\/layout flush nested/)
  assert.deepEqual(result.nestedSelectFlushes, [])
})

test('parser rejects later work of another kind and reports readiness work separately', () => {
  const fixture = chromeFixture()
  removeEvents(
    fixture,
    (event) =>
      isStyleOrLayout(event) &&
      event.ts >= NAVIGATION_US + 1200 &&
      event.ts < NAVIGATION_US + 1800
  )
  fixture.trace.traceEvents.push({
    name: 'RecalculateStyles',
    cat: 'devtools.timeline',
    ph: 'X',
    pid: PID,
    tid: TID,
    ts: NAVIGATION_US + 1600,
    dur: 25,
    args: { data: { frame: FRAME } }
  })
  const result = analyze(fixture)
  assert.equal(result.status, 'rejected')
  assert.match(result.reason, /No later duplicate style\/layout flush/)
  assert.equal(result.readinessFlushes.length, 2)
  assert.deepEqual(result.laterDuplicateFlushes, [])
})

test('parser rejects the first Select when it ends at or after FCP presentation', () => {
  for (const fcpOffset of [1200, 1150, 1050]) {
    const fixture = chromeFixture()
    findEvent(fixture, 'firstContentfulPaint').ts = NAVIGATION_US + fcpOffset
    const result = analyze(fixture)
    assert.equal(result.status, 'rejected')
    assert.match(result.reason, /not wholly before FCP presentation/)
  }
})

test('parser excludes async work, other frames, other threads, and wrong categories from Select nesting', () => {
  for (const mutate of [
    (event) => {
      event.ph = 'b'
    },
    (event) => {
      event.args = { data: { frame: 'child-frame' } }
    },
    (event) => {
      event.tid += 1
    },
    (event) => {
      event.cat = 'unrelated.timeline'
    }
  ]) {
    const fixture = chromeFixture()
    for (const event of fixture.trace.traceEvents)
      if (isStyleOrLayout(event) && event.ts < NAVIGATION_US + 1200)
        mutate(event)
    assert.equal(analyze(fixture).status, 'rejected')
  }
})

test('baseline without a filter preserves firstSelect=null instead of inventing a zero-time read', () => {
  const fixture = chromeFixture({ phase: 'before' })
  const result = analyze(fixture)
  assert.equal(result.status, 'not-applicable')
  assert.equal(result.firstSelect, null)
  assert.deepEqual(result.selects, [])
  assert.deepEqual(result.nestedSelectFlushes, [])
  assert.equal(result.readinessFlushes.length, 2)
})

const invalidCases = [
  [
    'reported trace loss',
    (fixture) => {
      fixture.sample.trace.dataLossOccurred = true
    },
    /Trace loss/
  ],
  [
    'missing loss status',
    (fixture) => {
      delete fixture.sample.trace.dataLossOccurred
    },
    /Trace loss/
  ],
  [
    'missing required category',
    (fixture) => {
      fixture.sample.trace.categories.pop()
    },
    /Missing required trace category/
  ],
  [
    'empty trace',
    (fixture) => {
      fixture.trace.traceEvents = []
    },
    /Missing full trace events/
  ],
  [
    'missing wrapper',
    (fixture) => {
      fixture.sample.native.attribution.wrapperInstalled = false
    },
    /wrapper was not installed/
  ],
  [
    'unfinished marker inventory',
    (fixture) => {
      fixture.sample.native.attribution.completed = false
    },
    /not closed at native ready/
  ],
  [
    'probe instrumentation failure',
    (fixture) => {
      fixture.sample.native.attribution.errors.push('mark failed')
    },
    /Browser probe errors/
  ],
  [
    'missing browser inventory',
    (fixture) => {
      fixture.sample.native.attribution.marks = []
    },
    /marker inventory is missing/
  ],
  [
    'lost installed mark',
    (fixture) => {
      removeEvents(
        fixture,
        (event) => event.name === `${PREFIX}installed:0:point`
      )
    },
    /Missing or duplicate marker/
  ],
  [
    'lost Select end',
    (fixture) => {
      removeEvents(fixture, (event) => event.name === `${PREFIX}select:1:end`)
    },
    /inventory mismatch/
  ],
  [
    'lost Select begin in trace and inventory',
    (fixture) => {
      const name = `${PREFIX}select:1:begin`
      removeEvents(fixture, (event) => event.name === name)
      fixture.sample.native.attribution.marks =
        fixture.sample.native.attribution.marks.filter(
          (mark) => mark.name !== name
        )
    },
    /Missing or duplicate marker/
  ],
  [
    'lost content-ready mark',
    (fixture) => {
      removeEvents(
        fixture,
        (event) => event.name === 'quest-native-content-ready'
      )
    },
    /Missing or duplicate marker/
  ],
  [
    'lost ready mark',
    (fixture) => {
      removeEvents(fixture, (event) => event.name === 'quest-native-ready')
    },
    /Missing or duplicate marker/
  ],
  [
    'duplicate installed mark',
    (fixture) => {
      fixture.trace.traceEvents.push(
        structuredClone(findEvent(fixture, `${PREFIX}installed:0:point`))
      )
    },
    /Missing or duplicate marker/
  ],
  [
    'duplicate browser inventory',
    (fixture) => {
      fixture.sample.native.attribution.marks.push({
        ...fixture.sample.native.attribution.marks[0]
      })
    },
    /Duplicate browser marker/
  ],
  [
    'unrecorded trace mark',
    (fixture) => {
      fixture.trace.traceEvents.push({
        ...findEvent(fixture, `${PREFIX}select:1:begin`),
        name: `${PREFIX}select:99:begin`
      })
    },
    /inventory mismatch/
  ],
  [
    'lost navigation',
    (fixture) => {
      removeEvents(fixture, (event) => event.name === 'navigationStart')
    },
    /navigation\/frame correspondence/
  ],
  [
    'ambiguous navigation',
    (fixture) => {
      fixture.trace.traceEvents.push(
        structuredClone(findEvent(fixture, 'navigationStart'))
      )
    },
    /navigation\/frame correspondence/
  ],
  [
    'wrong navigation frame',
    (fixture) => {
      findEvent(fixture, 'navigationStart').args.frame = 'other-frame'
    },
    /captured main frame/
  ],
  [
    'missing navigation frame',
    (fixture) => {
      delete findEvent(fixture, 'navigationStart').args.frame
    },
    /captured main frame/
  ],
  [
    'wrong captured frame',
    (fixture) => {
      fixture.sample.frameId = 'other-frame'
    },
    /captured main frame/
  ],
  [
    'wrong navigation thread',
    (fixture) => {
      findEvent(fixture, 'navigationStart').tid += 1
    },
    /different renderer threads/
  ],
  [
    'missing installed navigation ID',
    (fixture) => {
      delete findEvent(fixture, `${PREFIX}installed:0:point`).args.data
        .navigationId
    },
    /lacks Chrome navigationId/
  ],
  [
    'wrong marker navigation',
    (fixture) => {
      findEvent(fixture, `${PREFIX}select:1:end`).args.data.navigationId =
        'other-nav'
    },
    /Marker navigation mismatch/
  ],
  [
    'wrong marker thread',
    (fixture) => {
      findEvent(fixture, `${PREFIX}select:1:end`).tid += 1
    },
    /Marker thread mismatch/
  ],
  [
    'wrong marker process',
    (fixture) => {
      findEvent(fixture, `${PREFIX}select:1:end`).pid += 1
    },
    /Marker thread mismatch/
  ],
  [
    'wrong marker frame',
    (fixture) => {
      findEvent(fixture, `${PREFIX}select:1:end`).args.frame = 'other-frame'
    },
    /Marker frame mismatch/
  ],
  [
    'rounded marker startTime',
    (fixture) => {
      const event = findEvent(fixture, `${PREFIX}select:1:end`)
      event.args.data.startTime = Math.round(event.args.data.startTime)
    },
    /timestamp correspondence mismatch/
  ],
  [
    'missing marker startTime',
    (fixture) => {
      delete findEvent(fixture, `${PREFIX}select:1:end`).args.data.startTime
    },
    /timestamp correspondence mismatch/
  ],
  [
    'missing Chrome timestamp',
    (fixture) => {
      delete findEvent(fixture, `${PREFIX}select:1:end`).ts
    },
    /Missing Chrome timestamp/
  ],
  [
    'non-instantaneous marker',
    (fixture) => {
      findEvent(fixture, `${PREFIX}select:1:end`).ph = 'X'
    },
    /Not an instantaneous user timing marker/
  ],
  [
    'missing Chrome process',
    (fixture) => {
      for (const event of fixture.trace.traceEvents) delete event.pid
    },
    /Missing Chrome process\/thread/
  ],
  [
    'missing Chrome thread',
    (fixture) => {
      for (const event of fixture.trace.traceEvents) delete event.tid
    },
    /Missing Chrome process\/thread/
  ],
  [
    'non-finite browser timestamp',
    (fixture) => {
      fixture.sample.native.attribution.marks[0].startTime = NaN
    },
    /Missing browser marker timestamp/
  ],
  [
    'unexpected Select markers beyond count',
    (fixture) => {
      fixture.sample.native.attribution.counts.select = 0
    },
    /Unexpected select markers/
  ],
  [
    'fractional Select count',
    (fixture) => {
      fixture.sample.native.attribution.counts.select = 1.5
    },
    /Invalid select marker count/
  ],
  [
    'reversed Select interval',
    (fixture) => {
      findEvent(fixture, `${PREFIX}select:1:end`).ts = NAVIGATION_US + 1000
    },
    /Reversed select markers/
  ],
  [
    'reversed native readiness',
    (fixture) => {
      findEvent(fixture, 'quest-native-content-ready').ts = NAVIGATION_US + 4000
    },
    /Invalid native readiness ordering/
  ],
  [
    'missing readiness reads',
    (fixture) => {
      fixture.sample.native.attribution.counts.readiness = 0
    },
    /Unexpected readiness markers/
  ],
  [
    'missing SSE stream',
    (fixture) => {
      fixture.sample.native.attribution.counts.sse = 0
    },
    /Missing SSE stream markers/
  ],
  [
    'incorrect SSE dispatch order',
    (fixture) => {
      findEvent(fixture, `${PREFIX}sse-open:1:begin`).ts = NAVIGATION_US + 790
    },
    /Invalid SSE scheduling or dispatch order/
  ],
  [
    'missing FCP',
    (fixture) => {
      removeEvents(fixture, (event) => event.name === 'firstContentfulPaint')
    },
    /main-frame FCP/
  ],
  [
    'duplicate FCP',
    (fixture) => {
      fixture.trace.traceEvents.push(
        structuredClone(findEvent(fixture, 'firstContentfulPaint'))
      )
    },
    /main-frame FCP/
  ],
  [
    'wrong FCP frame',
    (fixture) => {
      findEvent(fixture, 'firstContentfulPaint').args.frame = 'other-frame'
    },
    /main-frame FCP/
  ],
  [
    'wrong FCP navigation',
    (fixture) => {
      findEvent(fixture, 'firstContentfulPaint').args.data.navigationId =
        'other-nav'
    },
    /main-frame FCP/
  ],
  [
    'wrong FCP thread',
    (fixture) => {
      findEvent(fixture, 'firstContentfulPaint').tid += 1
    },
    /another renderer thread/
  ],
  [
    'missing layout frame',
    (fixture) => {
      findEvent(fixture, 'Layout').args = {}
    },
    /Missing frame correspondence/
  ],
  [
    'negative flush duration',
    (fixture) => {
      findEvent(fixture, 'Layout').dur = -1
    },
    /Invalid style\/layout duration/
  ],
  [
    'non-finite flush duration',
    (fixture) => {
      findEvent(fixture, 'Layout').dur = Infinity
    },
    /Invalid style\/layout duration/
  ],
  [
    'head without first Select',
    (fixture) => {
      fixture.sample.native.attribution.counts.select = 0
      removeEvents(fixture, (event) =>
        event.name.startsWith(`${PREFIX}select:`)
      )
      fixture.sample.native.attribution.marks =
        fixture.sample.native.attribution.marks.filter(
          (mark) => !mark.name.startsWith(`${PREFIX}select:`)
        )
    },
    /Head sample has no first Select read/
  ],
  [
    'baseline with an unmarked filter',
    (fixture) => {
      fixture.sample.phase = 'before'
      fixture.sample.native.attribution.counts.select = 0
      removeEvents(fixture, (event) =>
        event.name.startsWith(`${PREFIX}select:`)
      )
      fixture.sample.native.attribution.marks =
        fixture.sample.native.attribution.marks.filter(
          (mark) => !mark.name.startsWith(`${PREFIX}select:`)
        )
    },
    /Unmarked filter in baseline/
  ]
]

for (const [name, mutate, reason] of invalidCases) {
  test(`parser invalidates ${name}`, () => {
    const fixture = chromeFixture()
    mutate(fixture)
    const result = analyze(fixture)
    assert.equal(result.status, 'invalid', result.reason)
    assert.equal(result.firstSelect, null)
    assert.match(result.reason, reason)
  })
}

test('parser invalidates incomplete and mismatched synchronous flush boundaries', () => {
  const missingEnd = chromeFixture({ pairedFlushes: true })
  removeEvents(
    missingEnd,
    (event) =>
      event.name === 'Layout' &&
      event.ph === 'E' &&
      event.ts === NAVIGATION_US + 1180
  )
  assert.equal(analyze(missingEnd).status, 'invalid')
  assert.match(
    analyze(missingEnd).reason,
    /Incomplete style\/layout trace event/
  )

  const mismatched = chromeFixture({ pairedFlushes: true })
  mismatched.trace.traceEvents.find((event) => event.ph === 'E').name =
    'WrongBoundary'
  assert.equal(analyze(mismatched).status, 'invalid')
  assert.match(
    analyze(mismatched).reason,
    /Mismatched synchronous trace boundaries/
  )
})

test('B/E normalization uses per-thread stacks and retains nested args and exact durations', () => {
  const events = [
    {
      name: 'Layout',
      ph: 'B',
      pid: 1,
      tid: 1,
      ts: 100,
      args: { beginData: { frame: FRAME } }
    },
    {
      name: 'UpdateLayoutTree',
      ph: 'B',
      pid: 1,
      tid: 2,
      ts: 105,
      args: { data: { frame: 'another-frame' } }
    },
    { name: 'FunctionCall', ph: 'B', pid: 1, tid: 1, ts: 110 },
    { ph: 'E', pid: 1, tid: 2, ts: 115 },
    { ph: 'E', pid: 1, tid: 1, ts: 120 },
    { ph: 'E', pid: 1, tid: 1, ts: 130, args: { endData: { layoutRoots: [] } } }
  ]
  const normalized = completeEvents([...events].reverse())
  const layout = normalized.find((event) => event.name === 'Layout')
  assert.equal(layout.dur, 30)
  assert.equal(layout.ph, 'X')
  assert.deepEqual(layout.args, {
    beginData: { frame: FRAME },
    endData: { layoutRoots: [] }
  })
  assert.equal(
    normalized.find((event) => event.name === 'UpdateLayoutTree').dur,
    10
  )
  assert.equal(
    normalized.find((event) => event.name === 'FunctionCall').dur,
    10
  )
  assert.equal(events[0].ph, 'B')
})

function roundFixtures() {
  const fixture = {
    jobs: [{ id: 'job-1', state: 'complete' }],
    events: [{ id: 'event-1', job: 'job-1' }],
    frozenBrowserTime: '2026-10-04T00:00:00.000Z',
    project: { id: 'project-1' },
    team: { id: 'team-1' },
    user: { id: 'user-1' },
    environment: { id: 'environment-1' },
    captureTrialSourceSha:
      process.env.SLIPWAY_QUEST_CAPTURE_TRIAL_SHA || 'head-sha'
  }
  return ['before-1', 'after-1', 'after-2', 'before-2'].map((name) => {
    const phase = name.startsWith('before') ? 'before' : 'after'
    const sourceSha =
      phase === 'before'
        ? process.env.QUEST_BASELINE_SHA || 'baseline-sha'
        : process.env.SLIPWAY_QUEST_CAPTURE_TRIAL_SHA || 'head-sha'
    return {
      name,
      fixture: { ...structuredClone(fixture), phase, sourceSha },
      report: {
        reconstructed: true,
        productionBenchmark: true,
        phase,
        sourceSha,
        samples: Array.from({ length: 5 }, (_, sample) => ({
          sample,
          capture: 'desktop-light',
          phase,
          sourceSha,
          trace: {
            traceFile: `trace-${sample}.json`,
            metadataFile: `trace-${sample}.meta.json`
          }
        }))
      }
    }
  })
}

test('ABBA validation retains exactly twenty raw samples, five for each original-head-head-original round', () => {
  const rounds = roundFixtures()
  const samples = validateRounds(rounds)
  assert.equal(samples.length, 20)
  assert.deepEqual(
    samples.map((sample) => `${sample.round}:${sample.sample}`),
    rounds.flatMap((round) =>
      round.report.samples.map((sample) => `${round.name}:${sample.sample}`)
    )
  )
  assert.equal(samples.filter((sample) => sample.phase === 'before').length, 10)
  assert.equal(samples.filter((sample) => sample.phase === 'after').length, 10)
})

for (const [name, mutate, reason] of [
  [
    'a lost round',
    (rounds) => {
      rounds.pop()
    },
    /ABBA/
  ],
  [
    'an extra round',
    (rounds) => {
      rounds.push(structuredClone(rounds[3]))
    },
    /ABBA/
  ],
  [
    'reordered rounds',
    (rounds) => {
      ;[rounds[1], rounds[3]] = [rounds[3], rounds[1]]
    },
    /ABBA/
  ],
  [
    'a lost sample',
    (rounds) => {
      rounds[1].report.samples.pop()
    },
    /five raw samples/
  ],
  [
    'an extra sample',
    (rounds) => {
      rounds[1].report.samples.push(
        structuredClone(rounds[1].report.samples[0])
      )
    },
    /five raw samples/
  ],
  [
    'reordered samples',
    (rounds) => {
      rounds[1].report.samples.reverse()
    },
    /Expected values to be strictly equal/
  ],
  [
    'a duplicate sample replacing a lost sample',
    (rounds) => {
      rounds[1].report.samples[1] = structuredClone(rounds[1].report.samples[0])
    },
    /Expected values to be strictly equal/
  ],
  [
    'changed fixture jobs',
    (rounds) => {
      rounds[2].fixture.jobs.push({ id: 'job-2' })
    },
    /Fixture mismatch: jobs/
  ],
  [
    'changed fixture readiness inputs',
    (rounds) => {
      rounds[2].fixture.frozenBrowserTime = '2026-10-05T00:00:00.000Z'
    },
    /Fixture mismatch: frozenBrowserTime/
  ],
  [
    'wrong sample phase',
    (rounds) => {
      rounds[1].report.samples[0].phase = 'before'
    },
    /Expected values to be strictly equal/
  ],
  [
    'wrong sample source',
    (rounds) => {
      rounds[1].report.samples[0].sourceSha = 'other-head'
    },
    /Expected values to be strictly equal/
  ],
  [
    'wrong report source',
    (rounds) => {
      rounds[1].report.sourceSha = 'other-head'
    },
    /Expected values to be strictly equal/
  ],
  [
    'wrong capture',
    (rounds) => {
      rounds[1].report.samples[0].capture = 'mobile-light'
    },
    /Expected values to be strictly equal/
  ],
  [
    'missing trace file',
    (rounds) => {
      delete rounds[1].report.samples[0].trace.traceFile
    },
    /assert/
  ],
  [
    'missing trace metadata',
    (rounds) => {
      delete rounds[1].report.samples[0].trace.metadataFile
    },
    /assert/
  ]
]) {
  test(`ABBA validation rejects ${name}`, () => {
    const rounds = roundFixtures()
    mutate(rounds)
    assert.throws(() => validateRounds(rounds), reason)
  })
}

class FakeCDP extends EventEmitter {
  constructor({
    text,
    categories = [...REQUIRED_CATEGORIES, OPTIONAL_CATEGORIES[0]],
    completion = { stream: 'trace-stream', dataLossOccurred: false },
    startError
  } = {}) {
    super()
    this.calls = []
    this.categories = categories
    this.completion = completion
    this.startError = startError
    this.text =
      text ??
      JSON.stringify({
        traceEvents: chromeFixture().trace.traceEvents,
        metadata: { label: 'Full trace: café ☕' }
      })
    this.chunks = [
      { data: this.text.slice(0, 19), eof: false },
      {
        data: Buffer.from(this.text.slice(19, 48)).toString('base64'),
        base64Encoded: true,
        eof: false
      },
      { data: this.text.slice(48), eof: false },
      { data: '', eof: true }
    ]
  }
  async send(method, parameters) {
    this.calls.push({ method, parameters })
    switch (method) {
      case 'Tracing.getCategories':
        return { categories: this.categories }
      case 'Tracing.start':
        if (this.startError) throw this.startError
        return {}
      case 'Tracing.end':
        this.emit('Tracing.tracingComplete', this.completion)
        return {}
      case 'IO.read':
        assert.equal(parameters.handle, 'trace-stream')
        assert.equal(parameters.size, 1024 * 1024)
        assert.ok(this.chunks.length, 'No reads after EOF')
        return this.chunks.shift()
      case 'IO.close':
        return {}
      default:
        assert.fail(`Unexpected CDP method: ${method}`)
    }
  }
}

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'quest-attribution-test-')
  )
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  return path.join(directory, 'nested', 'capture')
}

test('CDP ReturnAsStream drains every UTF-8/base64 chunk and persists full trace with explicit dataLossOccurred=false', async (t) => {
  const directory = temporaryDirectory(t)
  const cdp = new FakeCDP()
  const trace = await startTrace(cdp, directory, 2)
  const firstStop = trace.stop()
  assert.equal(trace.stop(), firstStop)
  const metadata = await firstStop
  assert.deepEqual(
    cdp.calls.find((call) => call.method === 'Tracing.start').parameters,
    {
      transferMode: 'ReturnAsStream',
      streamFormat: 'json',
      streamCompression: 'none',
      traceConfig: {
        recordMode: 'recordAsMuchAsPossible',
        includedCategories: [...REQUIRED_CATEGORIES, OPTIONAL_CATEGORIES[0]]
      }
    }
  )
  assert.equal(
    fs.readFileSync(path.join(directory, 'trace-2.json'), 'utf8'),
    cdp.text
  )
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(directory, 'trace-2.json'), 'utf8')),
    JSON.parse(cdp.text)
  )
  assert.deepEqual(
    JSON.parse(
      fs.readFileSync(path.join(directory, 'trace-2.meta.json'), 'utf8')
    ),
    metadata
  )
  assert.equal(metadata.dataLossOccurred, false)
  assert.equal(metadata.bytes, Buffer.byteLength(cdp.text))
  assert.equal(
    metadata.bytes,
    fs.statSync(path.join(directory, metadata.traceFile)).size
  )
  assert.equal(metadata.transferMode, 'ReturnAsStream')
  assert.equal(metadata.recordMode, 'recordAsMuchAsPossible')
  assert.deepEqual(
    metadata.unsupportedOptionalCategories,
    OPTIONAL_CATEGORIES.slice(1)
  )
  assert.equal(cdp.calls.filter((call) => call.method === 'IO.read').length, 4)
  assert.equal(
    cdp.calls.filter((call) => call.method === 'Tracing.end').length,
    1
  )
  assert.deepEqual(cdp.calls.at(-1), {
    method: 'IO.close',
    parameters: { handle: 'trace-stream' }
  })
  assert.equal(cdp.listenerCount('Tracing.tracingComplete'), 0)
  assert.equal(await trace.stop(), metadata)
})

for (const dataLossOccurred of [true, undefined]) {
  test(`CDP preserves the raw trace and completion metadata before rejecting ${
    dataLossOccurred === true ? 'reported trace loss' : 'missing loss status'
  }`, async (t) => {
    const directory = temporaryDirectory(t)
    const cdp = new FakeCDP({
      completion: { stream: 'trace-stream', dataLossOccurred }
    })
    const trace = await startTrace(cdp, directory, 0)
    await assert.rejects(
      trace.stop(),
      /must explicitly report dataLossOccurred=false/
    )
    assert.equal(
      fs.readFileSync(path.join(directory, 'trace-0.json'), 'utf8'),
      cdp.text
    )
    const metadata = JSON.parse(
      fs.readFileSync(path.join(directory, 'trace-0.meta.json'), 'utf8')
    )
    assert.equal(metadata.dataLossOccurred, dataLossOccurred)
    assert.equal(metadata.bytes, Buffer.byteLength(cdp.text))
    assert.equal(cdp.listenerCount('Tracing.tracingComplete'), 0)
    await assert.rejects(
      trace.stop(),
      /must explicitly report dataLossOccurred=false/
    )
    assert.equal(
      cdp.calls.filter((call) => call.method === 'Tracing.end').length,
      1
    )
  })
}

test('CDP refuses unsupported required categories before starting a trace', async (t) => {
  const cdp = new FakeCDP({ categories: ['devtools.timeline'] })
  await assert.rejects(
    startTrace(cdp, temporaryDirectory(t), 0),
    /Unsupported category: blink.user_timing/
  )
  assert.deepEqual(
    cdp.calls.map((call) => call.method),
    ['Tracing.getCategories']
  )
  assert.equal(cdp.listenerCount('Tracing.tracingComplete'), 0)
})

test('CDP removes its completion listener when starting fails', async (t) => {
  const startError = new Error('Tracing already started')
  const cdp = new FakeCDP({ startError })
  await assert.rejects(
    startTrace(cdp, temporaryDirectory(t), 0),
    (error) => error === startError
  )
  assert.equal(cdp.listenerCount('Tracing.tracingComplete'), 0)
})

test('CDP rejects a completion without a full stream handle', async (t) => {
  const cdp = new FakeCDP({ completion: { dataLossOccurred: false } })
  const trace = await startTrace(cdp, temporaryDirectory(t), 0)
  await assert.rejects(trace.stop(), /Complete CDP trace stream is required/)
  assert.equal(cdp.listenerCount('Tracing.tracingComplete'), 0)
  assert.equal(
    cdp.calls.some((call) => call.method === 'IO.read'),
    false
  )
})

function extractComparisonTrial(environment) {
  const file = path.join(__dirname, '../e2e/pages/projects/quest.test.js')
  const source = fs.readFileSync(file, 'utf8')
  const begin = '// BEGIN QUEST COMPARISON CAPTURE'
  const end = '// END QUEST COMPARISON CAPTURE'
  assert.equal(source.split(begin).length, 2, 'One bounded capture start')
  assert.equal(source.split(end).length, 2, 'One bounded capture end')
  const bounded = source.slice(
    source.indexOf(begin),
    source.indexOf(end) + end.length
  )
  const registrations = []
  const script = new vm.Script(
    `const { test } = require('sounding')\n${bounded}\n;({ installQuestFixture })`,
    { filename: 'extracted-quest-comparison-trial.cjs' }
  )
  const exported = script.runInNewContext({
    process: { env: { ...environment } },
    require(name) {
      if (name === 'sounding')
        return { test: (...args) => registrations.push(args) }
      if (name === 'node:fs') return { existsSync: () => false }
      if (name === '../../../support/quest-attribution-trace.cjs')
        return { installBrowserProbe }
      assert.fail(`Extracted trial attempted an unexpected dependency: ${name}`)
    }
  })
  return { ...exported, registrations }
}

for (const [name, environment, expectedCount] of [
  [
    'attribution head',
    {
      SLIPWAY_QUEST_ATTRIBUTION_TRACE: '1',
      SLIPWAY_QUEST_PRODUCTION_BENCHMARK: '1',
      SLIPWAY_QUEST_CAPTURE_PHASE: 'after'
    },
    1
  ],
  [
    'ordinary production head',
    {
      SLIPWAY_QUEST_PRODUCTION_BENCHMARK: '1',
      SLIPWAY_QUEST_CAPTURE_PHASE: 'after'
    },
    2
  ],
  [
    'ordinary production baseline',
    {
      SLIPWAY_QUEST_PRODUCTION_BENCHMARK: '1',
      SLIPWAY_QUEST_CAPTURE_PHASE: 'before'
    },
    1
  ],
  [
    'attribution baseline',
    {
      SLIPWAY_QUEST_ATTRIBUTION_TRACE: '1',
      SLIPWAY_QUEST_PRODUCTION_BENCHMARK: '1',
      SLIPWAY_QUEST_CAPTURE_PHASE: 'before'
    },
    1
  ]
]) {
  test(`bounded comparison source compiles and ${name} registers only its intended tests`, () => {
    const { registrations } = extractComparisonTrial(environment)
    assert.equal(registrations.length, expectedCount)
    assert.equal(
      registrations[0][0],
      'Quest comparison capture renders the real page with synthetic operational data'
    )
    if (expectedCount === 2)
      assert.equal(
        registrations[1][0],
        'Quest production assets expose first inspector and direct job run readiness'
      )
    for (const [, options, callback] of registrations) {
      assert.equal(options.browser, true)
      assert.equal(typeof callback, 'function')
    }
  })
}

async function captureInitScripts({
  attribution = true,
  phase = 'after'
} = {}) {
  const trial = extractComparisonTrial({
    SLIPWAY_QUEST_ATTRIBUTION_TRACE: attribution ? '1' : '0',
    SLIPWAY_QUEST_PRODUCTION_BENCHMARK: '1',
    SLIPWAY_QUEST_CAPTURE_PHASE: phase
  })
  const scripts = []
  const routes = []
  const updates = []
  const originalExecute = () =>
    assert.fail('No container or application execution')
  const sails = {
    models: Object.fromEntries(
      ['environment', 'app', 'team', 'user'].map((model) => [
        model,
        {
          updateOne(where) {
            return {
              async set(values) {
                updates.push({ model, where, values })
              }
            }
          }
        }
      ])
    ),
    helpers: { quest: { executeInContainer: originalExecute } }
  }
  const state = await trial.installQuestFixture(
    {
      sails,
      world: {
        current: {
          apps: { web: { id: 'app-1' } },
          environments: { production: { id: 'environment-1' } },
          projects: { deploymentTarget: { slug: 'quest-showcase' } },
          teams: { genesisTeam: { id: 'team-1' } },
          users: { genesisUser: { id: 'user-1' } }
        }
      },
      page: {
        raw: {
          async addInitScript(fn, parameters) {
            scripts.push({ source: fn.toString(), parameters })
          },
          async route(matcher, callback) {
            routes.push({ matcher, callback })
          },
          on() {},
          off() {}
        }
      }
    },
    phase,
    () => {},
    { clockMode: 'native-performance' }
  )
  assert.equal(routes.length, 2)
  assert.equal(updates.length, 4)
  assert.equal(
    updates.find((update) => update.model === 'app').values.status,
    'stopped'
  )
  state.restore()
  assert.equal(sails.helpers.quest.executeInContainer, originalExecute)
  return { scripts, state }
}

async function initScriptBrowser(options = {}) {
  const { scripts, state } = await captureInitScripts(options)
  const browser = browserFixture({
    skipInstall: true,
    pathname: state.projectPath
  })
  const sandbox = browser.sandbox
  const timers = []
  const frames = []
  const clearedTimers = []
  const nativeStreams = []
  const phaseElement = new browser.Element()
  const nativeNow = () => 123.456789
  const nativeMark = sandbox.performance.mark
  sandbox.performance.now = nativeNow
  sandbox.location.href = `https://example.test${state.projectPath}`
  sandbox.URL = URL
  sandbox.setTimeout = (callback, delay) => {
    const handle = timers.length + 1
    timers.push({ callback, delay, handle })
    return handle
  }
  sandbox.clearTimeout = (handle) => clearedTimers.push(handle)
  sandbox.setInterval = () =>
    assert.fail('Native-performance fixture should not introduce a heartbeat')
  sandbox.clearInterval = () => {}
  sandbox.requestAnimationFrame = (callback) => frames.push(callback)
  sandbox.PerformanceObserver = class {
    static supportedEntryTypes = []
  }
  sandbox.document = {
    querySelector(selector) {
      if (selector === 'script[data-page="app"]') return null
      assert.ok(
        [
          '[data-test="quest-workspace"]',
          '[aria-label="Live updates active"]'
        ].includes(selector)
      )
      return phaseElement
    },
    querySelectorAll(selector) {
      assert.equal(selector, 'h1,h2,h3')
      return [{ textContent: 'Quest' }]
    },
    body: { textContent: 'Quest Rebuild search index' },
    fonts: { status: 'loaded' }
  }
  sandbox.window.EventSource = class NativeEventSource {
    static CONNECTING = 0
    static OPEN = 1
    static CLOSED = 2
    constructor(url, parameters) {
      nativeStreams.push({ url, parameters, receiver: this })
    }
  }
  const nativeTimer = sandbox.setTimeout
  const context = vm.createContext(sandbox)
  for (const script of scripts) {
    sandbox.initParameters = structuredClone(script.parameters)
    new vm.Script(`(${script.source})(initParameters)`).runInContext(context)
  }
  assert.equal(sandbox.performance.now, nativeNow)
  assert.equal(sandbox.performance.mark, nativeMark)
  assert.equal(sandbox.setTimeout, nativeTimer)
  return {
    ...browser,
    scripts,
    state,
    timers,
    frames,
    clearedTimers,
    nativeStreams,
    probe: sandbox.window.__questAttributionProbe
  }
}

test('extracted fixture preserves the 10ms SSE timer, receiver, payload, and native transport delegation', async () => {
  const browser = await initScriptBrowser()
  const { sandbox, timers, state, probe } = browser
  assert.equal(browser.scripts.length, 3)
  assert.equal(probe.state.wrapperInstalled, true)
  const EventSource = sandbox.window.EventSource
  const parameters = { withCredentials: true }
  const native = new EventSource('/hmr', parameters)
  assert.equal(browser.nativeStreams.length, 1)
  assert.equal(browser.nativeStreams[0].receiver, native)
  assert.equal(browser.nativeStreams[0].parameters, parameters)
  assert.equal(timers.length, 0)

  const stream = new EventSource('/api/v1/projects/quest-showcase/quest/stream')
  const dispatched = []
  stream.onopen = function (event) {
    assert.equal(this, stream)
    assert.equal(event.type, 'open')
    dispatched.push('open')
  }
  stream.onmessage = function (event) {
    assert.equal(this, stream)
    assert.deepEqual(
      JSON.parse(event.data),
      JSON.parse(JSON.stringify({ workspace: state.workspace }))
    )
    dispatched.push('message')
  }
  assert.equal(timers.length, 1)
  assert.equal(timers[0].delay, 10)
  assert.equal(stream.timer, timers[0].handle)
  assert.equal(stream.readyState, 0)
  assert.deepEqual(dispatched, [])
  assert.equal(probe.state.counts.sse, 1)
  assert.deepEqual(browser.calls.marks.slice(1), [
    `${PREFIX}sse-register:1:begin`,
    `${PREFIX}sse-register:1:end`
  ])

  timers[0].callback()
  assert.equal(stream.readyState, 1)
  assert.deepEqual(dispatched, ['open', 'message'])
  assert.deepEqual(browser.calls.marks.slice(1), [
    `${PREFIX}sse-register:1:begin`,
    `${PREFIX}sse-register:1:end`,
    `${PREFIX}sse-callback:1:begin`,
    `${PREFIX}sse-open:1:begin`,
    `${PREFIX}sse-open:1:end`,
    `${PREFIX}sse-message:1:begin`,
    `${PREFIX}sse-message:1:end`,
    `${PREFIX}sse-callback:1:end`
  ])
  stream.close()
  assert.equal(stream.closed, true)
  assert.equal(stream.readyState, 2)
  assert.deepEqual(browser.clearedTimers, [stream.timer])
})

test('extracted SSE instrumentation preserves callback exceptions while closing its intervals', async () => {
  const browser = await initScriptBrowser()
  const stream = new browser.sandbox.window.EventSource(
    '/api/v1/projects/quest-showcase/quest/stream'
  )
  const callbackError = new Error('Application message handler failed')
  stream.onmessage = function () {
    assert.equal(this, stream)
    throw callbackError
  }
  assert.throws(
    () => browser.timers[0].callback(),
    (error) => error === callbackError
  )
  assert.deepEqual(browser.calls.marks.slice(-2), [
    `${PREFIX}sse-message:1:end`,
    `${PREFIX}sse-callback:1:end`
  ])
})

test('extracted readiness polls perform exactly one original rect read and freeze inventory at native ready', async () => {
  const browser = await initScriptBrowser()
  const { sandbox, frames, timers, probe } = browser
  assert.equal(browser.calls.rects.length, 0)
  assert.equal(frames.length, 1)
  frames.shift()()
  assert.equal(browser.calls.rects.length, 1)
  assert.equal(probe.state.counts.readiness, 1)
  assert.equal(sandbox.window.__questNativeProfile.readyMs, null)

  new sandbox.window.EventSource('/api/v1/projects/quest-showcase/quest/stream')
  timers[0].callback()
  frames.shift()()
  assert.equal(browser.calls.rects.length, 2)
  assert.equal(probe.state.counts.readiness, 2)
  assert.equal(sandbox.window.__questNativeProfile.contentReadyMs, 123.456789)
  assert.equal(probe.state.completed, false)
  frames.shift()()
  assert.equal(probe.state.completed, false)
  frames.shift()()
  assert.equal(sandbox.window.__questNativeProfile.readyMs, 123.456789)
  assert.equal(probe.state.completed, true)
  assert.equal(frames.length, 0)
  assert.equal(browser.calls.rects.length, 2)
  assert.equal(browser.calls.bounds.length, 0)
  assert.deepEqual(browser.calls.marks.slice(-2), [
    'quest-native-content-ready',
    'quest-native-ready'
  ])
})

test('ordinary production init scripts retain the same one-read readiness and 10ms SSE scheduling', async () => {
  const browser = await initScriptBrowser({ attribution: false })
  assert.equal(browser.scripts.length, 2)
  assert.equal(browser.probe, undefined)
  browser.frames.shift()()
  assert.equal(browser.calls.rects.length, 1)
  new browser.sandbox.window.EventSource(
    '/api/v1/projects/quest-showcase/quest/stream'
  )
  assert.equal(browser.timers[0].delay, 10)
  browser.timers[0].callback()
  browser.frames.shift()()
  assert.equal(browser.calls.rects.length, 2)
  assert.equal(
    browser.calls.marks.some((name) => name.startsWith(PREFIX)),
    false
  )
})
