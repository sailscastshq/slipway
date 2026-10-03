const { test } = require('sounding')
const workspaceModule = async () => ({
  ...(await import('../../../assets/js/lib/questWorkspace.mjs')),
  ...(await import('../../../assets/js/components/quest/questInvocation.mjs'))
})

test('Quest workspace capabilities fail closed for missing, legacy and unavailable runtimes', async ({
  expect
}) => {
  const { normalizeQuestWorkspace, questJobState } = await workspaceModule()
  const job = {
    name: 'daily',
    schedule: '1 day',
    paused: false,
    isRunning: false
  }
  for (const mode of [undefined, 'legacy', 'unavailable']) {
    const workspace = normalizeQuestWorkspace({
      version: 1,
      mode,
      capabilities: { invoke: true, pause: true },
      jobs: [job]
    })
    expect(workspace.capabilities.invoke).toBe(false)
    expect(workspace.capabilities.pause).toBe(false)
    expect(questJobState(job, workspace)).toBe('unavailable')
  }
  const workspace = normalizeQuestWorkspace({
    version: 1,
    mode: 'resident',
    capabilities: { invoke: 'true', pause: true }
  })
  expect(workspace.capabilities.invoke).toBe(false)
  expect(workspace.capabilities.pause).toBe(true)
  expect(workspace.capabilities.cancel).toBe(false)
  expect(questJobState(job, workspace)).toBe('scheduled')
  expect(questJobState(job, workspace, false)).toBe('unavailable')
  expect(questJobState({ ...job, isRunning: null }, workspace)).toBe(
    'unavailable'
  )
  expect(questJobState({ ...job, paused: null }, workspace)).toBe('unavailable')
})

test('Quest fallback history retains telemetry identities without synthesizing stable runs', async ({
  expect
}) => {
  const { normalizeQuestWorkspace } = await workspaceModule()
  const history = [{ eventId: 4, jobName: 'daily', event: 'completed' }]
  const workspace = normalizeQuestWorkspace(null, {
    jobs: [{ name: 'daily' }],
    jobHistory: history,
    jobsError: 'Unavailable'
  })
  expect(workspace.runs).toEqual([])
  expect(workspace.legacyEvents).toEqual(history)
  expect(workspace.reason).toBe('Unavailable')
  expect(workspace.capabilities.invoke).toBe(false)
})

test('Quest drafts preserve false, zero, empty strings and JSON null, with explicit omission', async ({
  expect
}) => {
  const { createQuestInputDraft, validateQuestInputs } = await workspaceModule()
  const schema = [
    { name: 'count', type: 'number', defaultsTo: 0 },
    { name: 'dryRun', type: 'boolean', required: true, defaultsTo: false },
    { name: 'payload', type: 'json', defaultsTo: null },
    { name: 'label', type: 'string', defaultsTo: '' },
    { name: 'optional', type: 'string' }
  ]
  const draft = createQuestInputDraft(schema)
  expect(draft.count).toEqual({ included: true, raw: 0 })
  expect(draft.dryRun).toEqual({ included: true, raw: false })
  expect(draft.payload).toEqual({ included: true, raw: 'null' })
  expect(draft.optional.included).toBe(false)
  expect(validateQuestInputs(schema, draft)).toEqual({
    valid: true,
    errors: {},
    values: { count: 0, dryRun: false, payload: null, label: '' }
  })
  draft.count.included = false
  expect('count' in validateQuestInputs(schema, draft).values).toBe(false)
})

test('Quest does not preload sensitive defaults or replay them from run inputs', async ({
  expect
}) => {
  const { createQuestInputDraft } = await workspaceModule()
  const draft = createQuestInputDraft(
    [
      {
        name: 'token',
        type: 'string',
        sensitive: true,
        required: true,
        defaultsTo: 'default-secret'
      },
      {
        name: 'optionalSecret',
        type: 'string',
        sensitive: true,
        defaultsTo: 'another-secret'
      },
      { name: 'limit', type: 'number', defaultsTo: 10 }
    ],
    {
      token: 'prior-secret',
      optionalSecret: 'prior-other',
      limit: 0,
      unknown: 'ignored'
    }
  )
  expect(draft).toEqual({
    token: { included: true, raw: '' },
    optionalSecret: { included: false, raw: '' },
    limit: { included: true, raw: 0 }
  })
  expect(JSON.stringify(draft).includes('secret')).toBe(false)
})

test('Quest validates required values, booleans, JSON shape, enum and numeric/string bounds', async ({
  expect
}) => {
  const { validateQuestInputs } = await workspaceModule()
  const cases = [
    [
      { name: 'input', type: 'string', required: true },
      { included: false, raw: '' }
    ],
    [
      { name: 'input', type: 'string', required: true },
      { included: true, raw: '' }
    ],
    [
      { name: 'input', type: 'number' },
      { included: true, raw: ' ' }
    ],
    [
      { name: 'input', type: 'number' },
      { included: true, raw: 'Infinity' }
    ],
    [
      { name: 'input', type: 'number', min: 1 },
      { included: true, raw: 0 }
    ],
    [
      { name: 'input', type: 'number', max: 2 },
      { included: true, raw: 3 }
    ],
    [
      { name: 'input', type: 'string', minLength: 2 },
      { included: true, raw: 'a' }
    ],
    [
      { name: 'input', type: 'string', maxLength: 2 },
      { included: true, raw: 'abc' }
    ],
    [
      { name: 'input', type: 'string', isIn: ['ok'] },
      { included: true, raw: 'no' }
    ],
    [
      { name: 'input', type: 'boolean' },
      { included: true, raw: 'false' }
    ],
    [
      { name: 'input', type: 'json' },
      { included: true, raw: '{bad' }
    ],
    [
      { name: 'input', type: 'array' },
      { included: true, raw: '{}' }
    ],
    [
      { name: 'input', type: 'object' },
      { included: true, raw: 'null' }
    ]
  ]
  for (const [input, entry] of cases) {
    const result = validateQuestInputs([input], { input: entry })
    expect(result.valid).toBe(false)
    expect(typeof result.errors.input).toBe('string')
    expect(result.values).toEqual({})
  }
})

test('Quest validates against the current schema rather than replaying unknown run inputs', async ({
  expect
}) => {
  const { createQuestInputDraft, validateQuestInputs } = await workspaceModule()
  const schema = [
    { name: 'count', type: 'number', min: 5 },
    { name: 'newRequired', type: 'boolean', required: true }
  ]
  const result = validateQuestInputs(
    schema,
    createQuestInputDraft(schema, { count: 2, removed: 'stale' })
  )
  expect(result.valid).toBe(false)
  expect(Object.keys(result.errors)).toEqual(['count', 'newRequired'])
  expect('removed' in result.values).toBe(false)
})

test('Quest canonical input objects keep special property names as own data', async ({
  expect
}) => {
  const { createQuestInputDraft, validateQuestInputs } = await workspaceModule()
  const schema = [
    { name: '__proto__', type: 'json', defaultsTo: { safe: true } },
    { name: 'constructor', type: 'string', defaultsTo: 'ordinary' }
  ]
  const result = validateQuestInputs(schema, createQuestInputDraft(schema))
  expect(result.valid).toBe(true)
  expect(Object.getPrototypeOf(result.values)).toBe(Object.prototype)
  expect(Object.prototype.hasOwnProperty.call(result.values, '__proto__')).toBe(
    true
  )
  expect(JSON.parse(JSON.stringify(result.values)).constructor).toBe('ordinary')
})

test('Quest stable run merging is deduplicated, ordered and resists late acceptance regression', async ({
  expect
}) => {
  const { mergeQuestRuns } = await workspaceModule()
  const completed = {
    runId: 'one',
    jobName: 'a',
    state: 'completed',
    requestedAt: 1,
    finishedAt: 5
  }
  const initial = [
    completed,
    { runId: 'two', state: 'running', requestedAt: 2 }
  ]
  const merged = mergeQuestRuns(initial, [
    { runId: 'one', state: 'accepted', requestedAt: 1 },
    { runId: 'two', state: 'accepted', requestedAt: 2 },
    { runId: 'three', state: 'accepted', requestedAt: 3 },
    { eventId: 4, event: 'completed' }
  ])
  expect(merged.map((run) => run.runId)).toEqual(['three', 'two', 'one'])
  expect(merged.find((run) => run.runId === 'one')).toEqual(completed)
  expect(merged.find((run) => run.runId === 'two').state).toBe('running')
  expect(
    mergeQuestRuns(initial, [
      { runId: 'two', state: 'failed', finishedAt: 6 }
    ])[0].state
  ).toBe('failed')
})

test('Quest invocation sends exactly the reviewed payload with no automatic retry', async ({
  expect
}) => {
  const { requestQuestInvocation } = await workspaceModule()
  const body = {
    jobInputs: { dryRun: false, count: 0, payload: null },
    metadataVersion: 'schema-1',
    runtimeId: 'runtime-1',
    requestId: 'request-1',
    productionConfirmed: true
  }
  let calls = 0
  const result = await requestQuestInvocation(
    '/synthetic/jobs/test/run',
    body,
    'csrf-token',
    async (url, options) => {
      calls++
      expect(url).toBe('/synthetic/jobs/test/run')
      expect(options.method).toBe('POST')
      expect(options.headers['x-csrf-token']).toBe('csrf-token')
      expect(JSON.parse(options.body)).toEqual(body)
      return {
        ok: true,
        status: 202,
        json: async () => ({
          run: { runId: 'run-1', jobName: 'test', state: 'accepted' }
        })
      }
    }
  )
  expect(calls).toBe(1)
  expect(result).toEqual({
    state: 'accepted',
    run: { runId: 'run-1', jobName: 'test', state: 'accepted' }
  })
})

test('Quest invocation rejections cannot create runs even when the body claims success', async ({
  expect
}) => {
  const { requestQuestInvocation } = await workspaceModule()
  for (const status of [400, 401, 403, 404, 409, 419]) {
    let calls = 0
    const result = await requestQuestInvocation(
      '/synthetic',
      {},
      '',
      async () => {
        calls++
        return {
          ok: false,
          status,
          json: async () => ({
            run: { runId: 'fake', state: 'completed' },
            success: true,
            exitCode: 0
          })
        }
      }
    )
    expect(calls).toBe(1)
    expect(result.state).toBe('request_failed')
    expect('run' in result).toBe(false)
    expect('exitCode' in result).toBe(false)
  }
})

test('Quest invocation disconnects and invalid successful responses remain unconfirmed', async ({
  expect
}) => {
  const { requestQuestInvocation } = await workspaceModule()
  const responses = [
    async () => {
      throw new Error('Disconnected')
    },
    async () => ({
      ok: true,
      json: async () => {
        throw new Error('HTML')
      }
    }),
    ...[
      {},
      null,
      { success: true, exitCode: 0 },
      { run: { runId: 3, state: 'accepted' } },
      { run: { runId: 'run-1' } }
    ].map((body) => async () => ({ ok: true, json: async () => body }))
  ]
  for (const fetchRequest of responses) {
    const result = await requestQuestInvocation(
      '/synthetic',
      {},
      '',
      fetchRequest
    )
    expect(result.state).toBe('unconfirmed')
    expect(result.error).toContain('Check Runs')
    expect('run' in result).toBe(false)
  }
})

test('Quest empty inputs are only definitive with explicit typed resident metadata', async ({
  expect
}) => {
  const { questInputMetadataAvailable } = await workspaceModule()
  const job = { name: 'no-inputs', metadataVersion: 'v1', inputs: [] }
  const workspace = { mode: 'resident', capabilities: { typedInputs: true } }
  expect(questInputMetadataAvailable(job, workspace)).toBe(true)
  expect(
    questInputMetadataAvailable(job, { ...workspace, mode: 'legacy' })
  ).toBe(false)
  expect(
    questInputMetadataAvailable(job, { ...workspace, mode: 'unavailable' })
  ).toBe(false)
  expect(
    questInputMetadataAvailable(job, {
      ...workspace,
      capabilities: { typedInputs: false }
    })
  ).toBe(false)
  expect(
    questInputMetadataAvailable(job, { ...workspace, capabilities: {} })
  ).toBe(false)
  expect(
    questInputMetadataAvailable({ name: 'source-only', inputs: [] }, workspace)
  ).toBe(false)
  expect(
    questInputMetadataAvailable({ ...job, inputs: undefined }, workspace)
  ).toBe(false)
})

test('Quest unknown overlap metadata never implies concurrent execution is allowed', async ({
  expect
}) => {
  const { questOverlapLabel } = await workspaceModule()
  expect(questOverlapLabel({})).toBe('Unavailable')
  expect(questOverlapLabel({ withoutOverlapping: null })).toBe('Unavailable')
  expect(questOverlapLabel({ withoutOverlapping: 'false' })).toBe('Unavailable')
  expect(questOverlapLabel({ withoutOverlapping: false })).toBe(
    'Concurrent executions allowed'
  )
  expect(questOverlapLabel({ withoutOverlapping: true })).toBe(
    'Prevent overlap in this app process'
  )
})

test('Quest server failures and explicit uncertain admission never enable a blind retry', async ({
  expect
}) => {
  const { requestQuestInvocation } = await workspaceModule()
  for (const [status, code] of [
    [500],
    [502],
    [504],
    [400, 'QUEST_UNCONFIRMED'],
    [409, 'QUEST_UNCONFIRMED']
  ]) {
    let calls = 0
    const result = await requestQuestInvocation(
      '/synthetic',
      { requestId: 'same-reviewed-attempt' },
      '',
      async (url, options) => {
        calls++
        expect(JSON.parse(options.body).requestId).toBe('same-reviewed-attempt')
        return {
          ok: false,
          status,
          json: async () => ({
            code,
            message: 'Acceptance response lost.',
            run: { runId: 'not-authoritative', state: 'completed' }
          })
        }
      }
    )
    expect(calls).toBe(1)
    expect(result.state).toBe('unconfirmed')
    expect(result.error).toContain('Check Runs')
    expect('run' in result).toBe(false)
  }
})

test('Quest selected-job history reads exact scoped URLs and rejects late prior-selection responses', async ({
  expect
}) => {
  const { createQuestHistoryLoader } = await workspaceModule()
  const pending = []
  const loader = createQuestHistoryLoader(
    (url, options) =>
      new Promise((resolve) =>
        pending.push({ url, signal: options.signal, resolve })
      )
  )
  const first = loader.load('/quest/runs?job=first&cursor=first-page')
  const second = loader.load('/quest/runs?job=second')
  expect(pending[0].signal.aborted).toBe(true)
  expect(pending[0].url).toBe('/quest/runs?job=first&cursor=first-page')
  expect(pending[1].url).toBe('/quest/runs?job=second')
  const secondPage = {
    runs: [{ runId: 'second-run', jobName: 'second', state: 'completed' }],
    legacyEvents: [],
    nextCursor: 'second-page'
  }
  pending[1].resolve({ ok: true, json: async () => secondPage })
  expect(await second).toEqual({ data: secondPage, error: null })
  pending[0].resolve({
    ok: true,
    json: async () => ({
      runs: [{ runId: 'first-run', jobName: 'first' }],
      legacyEvents: [],
      nextCursor: null
    })
  })
  expect(await first).toEqual({ stale: true })
})

test('Quest selected-job history cancellation prevents old errors or rows from reaching dismissed views', async ({
  expect
}) => {
  const { createQuestHistoryLoader } = await workspaceModule()
  let rejectRequest
  const loader = createQuestHistoryLoader(
    () =>
      new Promise((resolve, reject) => {
        rejectRequest = reject
      })
  )
  const pending = loader.load('/quest/runs?job=first')
  loader.cancel()
  rejectRequest(new Error('Connection interrupted'))
  expect(await pending).toEqual({ stale: true })
  for (const response of [
    { ok: false, status: 403 },
    { ok: true, json: async () => ({ runs: [] }) }
  ]) {
    const reader = createQuestHistoryLoader(async () => response)
    const result = await reader.load('/quest/runs?job=first')
    expect(result.data).toBe(null)
    expect(typeof result.error).toBe('string')
  }
})

test('Quest defers inactive run history and run-only components on the initial Jobs view', async ({
  expect
}) => {
  const fs = require('node:fs')
  const { parse, compileScript } = require('@vue/compiler-sfc')
  const pageSource = fs.readFileSync(
    require.resolve('../../../assets/js/pages/projects/quest.vue'),
    'utf8'
  )
  const { descriptor, errors } = parse(pageSource)
  expect(errors).toEqual([])
  const script = compileScript(descriptor, { id: 'quest-lazy-workspace' })
  expect(script.imports.QuestRunDetail).toBe(undefined)
  expect(script.imports.QuestRunDialog).toBe(undefined)
  expect(script.imports.QuestJobDetail).toBe(undefined)
  expect(script.imports.QuestGlobalRuns).toBe(undefined)
  expect(script.imports.QuestRuns).toBe(undefined)
  expect(descriptor.scriptSetup.content).toContain(
    'const QuestRunDetail = defineAsyncComponent('
  )
  expect(descriptor.scriptSetup.content).toContain(
    'const QuestRunDialog = defineAsyncComponent('
  )
  const { baseParse } = require('@vue/compiler-dom')
  const tree = baseParse(descriptor.template.content)
  const elements = []
  function visit(node) {
    if (node.type === 1) elements.push(node)
    for (const child of node.children || []) visit(child)
  }
  visit(tree)
  const attribute = (element, name) =>
    element.props.find((prop) => prop.type === 6 && prop.name === name)?.value
      ?.content
  const condition = (element) =>
    element.props.find((prop) => prop.type === 7 && prop.name === 'if')?.exp
      ?.content
  const globalRuns = elements.find(
    (element) =>
      attribute(element, 'data-value') === 'runs' &&
      attribute(element, 'class') === 'pt-4'
  )
  expect(Boolean(globalRuns)).toBe(true)
  expect(
    globalRuns.children.some(
      (child) =>
        child.tag === 'template' && condition(child) === "activeTab === 'runs'"
    )
  ).toBe(true)
  expect(
    condition(elements.find((element) => element.tag === 'QuestRunDialog'))
  ).toBe('review')
  expect(
    condition(elements.find((element) => element.tag === 'QuestJobDetail'))
  ).toBe("selectedJob && activeTab === 'jobs'")
  expect(
    globalRuns.children.some((child) =>
      child.children?.some((element) => element.tag === 'QuestGlobalRuns')
    )
  ).toBe(true)
  const dialog = fs.readFileSync(
    require.resolve('../../../assets/js/components/quest/QuestRunDialog.vue'),
    'utf8'
  )
  expect(dialog).toContain('{ immediate: true }')
})

test('Quest deferred panels expose a bounded loading error and keep invocation helpers outside the initial module', async ({
  expect
}) => {
  const fs = require('node:fs')
  const eager = await import('../../../assets/js/lib/questWorkspace.mjs')
  expect(eager.createQuestInputDraft).toBe(undefined)
  expect(eager.validateQuestInputs).toBe(undefined)
  expect(eager.requestQuestInvocation).toBe(undefined)
  const page = fs.readFileSync(
    require.resolve('../../../assets/js/pages/projects/quest.vue'),
    'utf8'
  )
  expect(page).toContain('loadingComponent: QuestPanelFallback')
  expect(page).toContain('errorComponent: QuestPanelFallback')
  expect(page).toContain('timeout: 15000')
  const fallback = fs.readFileSync(
    require.resolve(
      '../../../assets/js/components/quest/QuestPanelFallback.vue'
    ),
    'utf8'
  )
  expect(fallback).toContain('window.location.reload()')
  expect(fallback).toContain('@click="reload"')
  expect(fallback).toContain('Could not load this view.')
  expect(fallback.includes('fetch(')).toBe(false)
})

test('Quest due time displays the supplied timestamp in explicitly separated runtime and viewer zones', async ({
  expect
}) => {
  const { questDueTimes } = await workspaceModule()
  const dueAt = Date.parse('2026-06-01T12:00:00.000Z')
  const times = questDueTimes(dueAt, 'America/New_York', {
    locale: 'en-US',
    viewerTimeZone: 'America/Los_Angeles'
  })
  expect(times.runtimeZone).toBe('America/New_York')
  expect(times.viewerZone).toBe('America/Los_Angeles')
  expect(times.runtime).toContain('8:00:00 AM EDT')
  expect(times.viewer).toContain('5:00:00 AM PDT')
  expect(times.timezoneStatus).toBe('available')
  const winter = questDueTimes(
    Date.parse('2026-01-01T12:00:00.000Z'),
    'America/New_York',
    { locale: 'en-US', viewerTimeZone: 'UTC' }
  )
  expect(winter.runtime).toContain('7:00:00 AM EST')
  expect(winter.viewer).toContain('12:00:00 PM UTC')
})

test('Quest missing or invalid runtime zones never masquerade as viewer timezone', async ({
  expect
}) => {
  const { questDueTimes } = await workspaceModule()
  for (const timezone of [undefined, null, '']) {
    const times = questDueTimes(1000, timezone, {
      locale: 'en-US',
      viewerTimeZone: 'UTC'
    })
    expect(times.runtime).toBe(null)
    expect(times.runtimeZone).toBe(null)
    expect(times.timezoneStatus).toBe('unreported')
    expect(times.viewer).toContain('UTC')
  }
  const invalid = questDueTimes(1000, 'Synthetic/Not-A-Timezone', {
    locale: 'en-US',
    viewerTimeZone: 'UTC'
  })
  expect(invalid.runtime).toBe(null)
  expect(invalid.runtimeZone).toBe(null)
  expect(invalid.timezoneStatus).toBe('invalid')
  expect(invalid.viewer).toContain('UTC')
})

test('Quest due time never invents a timestamp when next-run data is missing or invalid', async ({
  expect
}) => {
  const { questDueTimes } = await workspaceModule()
  for (const timestamp of [
    undefined,
    null,
    '',
    NaN,
    Infinity,
    'invalid timestamp',
    false
  ]) {
    const times = questDueTimes(timestamp, 'UTC', {
      locale: 'en-US',
      viewerTimeZone: 'UTC'
    })
    expect(times.runtime).toBe(null)
    expect(times.viewer).toBe(null)
  }
})

test('Quest snapshot authority expires at a bounded age and permits only small clock skew', async ({
  expect
}) => {
  const { questSnapshotIsFresh } = await workspaceModule()
  const snapshot = { mode: 'resident', observedAt: 100000 }
  expect(questSnapshotIsFresh(snapshot, 100000)).toBe(true)
  expect(questSnapshotIsFresh(snapshot, 129999)).toBe(true)
  expect(questSnapshotIsFresh(snapshot, 130000)).toBe(false)
  expect(questSnapshotIsFresh(snapshot, 130001)).toBe(false)
  expect(questSnapshotIsFresh(snapshot, 95000)).toBe(true)
  expect(questSnapshotIsFresh(snapshot, 94999)).toBe(false)
  expect(questSnapshotIsFresh({ ...snapshot, mode: 'legacy' }, 100000)).toBe(
    false
  )
  expect(
    questSnapshotIsFresh({ ...snapshot, mode: 'unavailable' }, 100000)
  ).toBe(false)
})

test('Quest invalid snapshot times fail closed without mutating historical run state', async ({
  expect
}) => {
  const { questSnapshotIsFresh } = await workspaceModule()
  for (const observedAt of [undefined, null, NaN, Infinity, '100000']) {
    const snapshot = {
      mode: 'resident',
      observedAt,
      runs: [{ runId: 'kept', state: 'running' }]
    }
    expect(questSnapshotIsFresh(snapshot, 100000)).toBe(false)
    expect(snapshot.runs[0].state).toBe('running')
  }
  expect(
    questSnapshotIsFresh({ mode: 'resident', observedAt: 100000 }, NaN)
  ).toBe(false)
})

test('Quest snapshot receipt refreshes authority between display ticks and expires at exactly thirty seconds', async ({
  expect
}) => {
  const { createQuestSnapshotAuthority } = await workspaceModule()
  let time = 100000
  let nextTimer = 0
  const timers = new Map()
  const changes = []
  const authority = createQuestSnapshotAuthority({
    now: () => time,
    setTimer: (callback, delay) => {
      const id = ++nextTimer
      timers.set(id, { callback, at: time + delay })
      return id
    },
    clearTimer: (id) => timers.delete(id),
    onChange: (fresh) => changes.push(fresh)
  })
  authority.observe({ mode: 'resident', observedAt: time })
  const oldCallback = timers.get(1).callback
  time += 10000 // A fresh SSE observation arrives before a 15s display tick.
  authority.observe({ mode: 'resident', observedAt: time })
  expect(authority.isFresh()).toBe(true)
  expect(timers.size).toBe(1)
  expect(timers.get(2).at).toBe(140000)
  oldCallback() // A cancelled prior-generation expiry cannot revoke new state.
  expect(authority.isFresh()).toBe(true)
  time = 139999
  expect(authority.isFresh()).toBe(true)
  time = 140000
  timers.get(2).callback()
  expect(authority.isFresh()).toBe(false)
  expect(changes).toEqual([true, false])
  authority.dispose()
})

test('Quest an invalid future observation stays unavailable until a valid new snapshot arrives', async ({
  expect
}) => {
  const { createQuestSnapshotAuthority } = await workspaceModule()
  let time = 100000
  const timers = new Map()
  const authority = createQuestSnapshotAuthority({
    now: () => time,
    setTimer: (callback, delay) => {
      timers.set(1, { callback, delay })
      return 1
    },
    clearTimer: (id) => timers.delete(id)
  })
  const future = { mode: 'resident', observedAt: 110000 }
  expect(authority.observe(future)).toBe(false)
  expect(timers.size).toBe(0)
  time = 110000
  expect(authority.isFresh()).toBe(false)
  expect(authority.observe({ ...future })).toBe(true)
  expect(authority.isFresh()).toBe(true)
  authority.dispose()
  expect(authority.isFresh()).toBe(false)
  expect(timers.size).toBe(0)
})

test('Quest closing a typed review clears its form without dereferencing the cleared draft', async ({
  expect
}) => {
  const fs = require('node:fs')
  const Vue = require('vue')
  const { parse, compileScript } = require('@vue/compiler-sfc')
  const helpers = await workspaceModule()
  const source = fs.readFileSync(
    require.resolve('../../../assets/js/components/quest/QuestRunDialog.vue'),
    'utf8'
  )
  const { descriptor } = parse(source)
  const script = compileScript(descriptor, {
    id: 'quest-dialog-close',
    inlineTemplate: true
  })
  const Slot = {
    render() {
      return Vue.h('section', null, this.$slots.default?.())
    }
  }
  const dependencies = {
    vue: Vue,
    '@/lib/questWorkspace.mjs': helpers,
    './questInvocation.mjs': helpers
  }
  const compiled = script.content
    .replace(
      /import\s+(\{[\s\S]*?\}|\w+)\s+from\s+['"]([^'"]+)['"]/g,
      (_, binding, name) =>
        binding.startsWith('{')
          ? `const ${binding.replace(
              / as /g,
              ': '
            )} = dependencies[${JSON.stringify(name)}]`
          : `const ${binding} = Slot`
    )
    .replace('export default', 'return')
  const Dialog = new Function('dependencies', 'Slot', compiled)(
    dependencies,
    Slot
  )
  const root = { children: [] }
  const remove = (node) => {
    const siblings = node.parent?.children
    if (siblings) {
      const index = siblings.indexOf(node)
      if (index >= 0) siblings.splice(index, 1)
    }
  }
  const renderer = Vue.createRenderer({
    patchProp(node, key, previous, next) {
      node.props[key] = next
      if (key === 'type') node.type = next
    },
    createElement(tag) {
      return {
        tag,
        tagName: tag.toUpperCase(),
        props: {},
        children: [],
        addEventListener() {},
        removeEventListener() {}
      }
    },
    insert(node, parent, anchor) {
      remove(node)
      const index = anchor ? parent.children.indexOf(anchor) : -1
      if (index >= 0) parent.children.splice(index, 0, node)
      else parent.children.push(node)
      node.parent = parent
    },
    createText(text) {
      return { text }
    },
    createComment(text) {
      return { comment: text }
    },
    setText(node, text) {
      node.text = text
    },
    setElementText(node, text) {
      node.text = text
      node.children = []
    },
    parentNode(node) {
      return node.parent
    },
    nextSibling(node) {
      const siblings = node.parent?.children || []
      return siblings[siblings.indexOf(node) + 1] || null
    },
    remove
  })
  const open = Vue.ref(true)
  const errors = []
  const review = {
    job: {
      name: 'synthetic',
      inputs: [{ name: 'optionalNote', type: 'string' }]
    },
    target: {
      appName: 'Synthetic',
      environmentName: 'Test',
      isProduction: false
    }
  }
  const app = renderer.createApp({
    render() {
      return Vue.h(Dialog, { open: open.value, review })
    }
  })
  app.config.errorHandler = (error) => errors.push(error.message)
  function forms(node) {
    return (
      (node.tag === 'form' ? 1 : 0) +
      (node.children || []).reduce((total, child) => total + forms(child), 0)
    )
  }
  try {
    app.mount(root)
    await Vue.nextTick()
    expect(forms(root)).toBe(1)
    open.value = false
    await Vue.nextTick()
    expect(errors).toEqual([])
    expect(forms(root)).toBe(0)
    open.value = true
    await Vue.nextTick()
    expect(errors).toEqual([])
    expect(forms(root)).toBe(1)
  } finally {
    app.unmount()
  }
})

test('Quest result counts use singular labels only for exactly one row or item', async ({
  expect
}) => {
  const { questResultCountLabel } = await workspaceModule()
  expect(questResultCountLabel(0, 'row')).toBe('0 rows')
  expect(questResultCountLabel(1, 'row')).toBe('1 row')
  expect(questResultCountLabel(2, 'row')).toBe('2 rows')
  expect(questResultCountLabel(1, 'item')).toBe('1 item')
  expect(questResultCountLabel(2, 'item')).toBe('2 items')
})
