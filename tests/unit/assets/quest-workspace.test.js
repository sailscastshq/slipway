const { test } = require('sounding')
const workspaceModule = () =>
  import('../../../assets/js/lib/questWorkspace.mjs')

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
  for (const status of [400, 401, 403, 404, 409, 419, 500, 502]) {
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
