const { test } = require('sounding')
const helmRuntime = require('../../../../api/lib/helm-runtime')

test('Helm returns complete final expressions instead of physical lines', async ({
  sails,
  expect
}) => {
  const result = await runHelm(
    sails,
    `
const Creator = {
  async find(criteria) {
    return [{ publicId: 'creator-1', criteria }]
  }
}
const now = new Date('2026-07-28T00:00:00.000Z').toISOString()

await Creator.find({
  where: {
    subscriptionStatus: 'active',
    subscriptionEndsAt: { '>=': now }
  },
  select: [
    'publicId',
    'subscriptionProvider',
    'subscriptionStatus'
  ]
})
`
  )

  expect(result.success).toBe(true)
  expect(result.value[0].publicId).toBe('creator-1')
  expect(result.value[0].criteria.where.subscriptionStatus).toBe('active')
  expect(result.value[0].criteria.select).toEqual([
    'publicId',
    'subscriptionProvider',
    'subscriptionStatus'
  ])
  expect(result.status).toBe('success')
  expect(result.rowCount).toBe(1)
  expect(result.outputBytes).toBe(Buffer.byteLength(result.output))
})

test('Helm captures parser-backed inline inspections without changing expression values', async ({
  sails,
  expect
}) => {
  const result = await runHelm(
    sails,
    [
      'const values = []',
      'for (const number of [1, 2, 3]) {',
      '  const doubled = number * 2 // @inspect',
      '  values.push(doubled)',
      '}',
      'values // @inspect'
    ].join('\n')
  )

  expect(result.success).toBe(true)
  expect(result.value).toEqual([2, 4, 6])
  expect(result.inspections.length).toBe(2)
  expect(result.inspections[0].line).toBe(3)
  expect(result.inspections[0].values.map(({ value }) => value)).toEqual([
    2, 4, 6
  ])
  expect(result.inspections[1].line).toBe(6)
  expect(result.inspections[1].values[0].value).toEqual([2, 4, 6])

  const capped = await runHelm(
    sails,
    [
      'for (let index = 0; index < 25; index++) {',
      '  index // @inspect',
      '}'
    ].join('\n')
  )
  expect(capped.success).toBe(true)
  expect(capped.inspections[0].values.length).toBe(20)
  expect(capped.inspections[0].omittedCount).toBe(5)

  const lookalike = await runHelm(
    sails,
    'const marker = "// @inspect and // @trace queries"\nmarker'
  )
  expect(lookalike.inspections).toEqual([])
  expect(lookalike.queryTrace).toBe(null)
  const ordinarySource = helmRuntime.prepareSource('1 + 1')
  const tracedSource = helmRuntime.prepareSource('// @trace queries\n1 + 1')
  expect(
    helmRuntime
      .buildRunnerSource({
        preparedSource: ordinarySource.source,
        finalExpression: ordinarySource.finalExpression,
        traceQueries: ordinarySource.traceQueries
      })
      .includes('sendNativeQuery')
  ).toBe(false)
  expect(
    helmRuntime
      .buildRunnerSource({
        preparedSource: tracedSource.source,
        finalExpression: tracedSource.finalExpression,
        traceQueries: tracedSource.traceQueries
      })
      .includes('sendNativeQuery')
  ).toBe(true)

  const invalid = await runHelm(sails, 'const value = 1\n// @inspect\nvalue')
  expect(invalid.success).toBe(false)
  expect(invalid.error.code).toBe('HELM_SOURCE_INVALID')
  expect(invalid.error.message).toContain('complete expression')
})

test('Helm query tracing is opt-in, execution-scoped, bounded, and redacted', async ({
  sails,
  expect
}) => {
  const result = await runHelm(
    sails,
    [
      '// @trace queries',
      "await Project.find({ slug: 'waterline-secret' }).limit(1)",
      'for (let index = 0; index < 105; index++) {',
      '  await sails.getDatastore().sendNativeQuery(',
      '    "SELECT \'native-secret\' AS value, 99 AS count"',
      '  )',
      '}',
      "'done'"
    ].join('\n'),
    { bootstrapSails: true }
  )

  expect(result.success).toBe(true)
  expect(result.value).toBe('done')
  expect(result.queryTrace.enabled).toBe(true)
  expect(result.queryTrace.entries.length).toBe(100)
  expect(result.queryTrace.omittedCount).toBe(6)
  expect({
    kind: result.queryTrace.entries[0].kind,
    model: result.queryTrace.entries[0].model,
    datastore: result.queryTrace.entries[0].datastore,
    method: result.queryTrace.entries[0].method,
    status: result.queryTrace.entries[0].status,
    criteria: result.queryTrace.entries[0].criteria
  }).toEqual({
    kind: 'waterline',
    model: 'project',
    datastore: 'default',
    method: 'find',
    status: 'success',
    criteria: {
      where: {
        slug: '[value]'
      },
      limit: '[value]'
    }
  })
  expect({
    kind: result.queryTrace.entries[1].kind,
    datastore: result.queryTrace.entries[1].datastore,
    method: result.queryTrace.entries[1].method,
    status: result.queryTrace.entries[1].status,
    statement: result.queryTrace.entries[1].statement
  }).toEqual({
    kind: 'native',
    datastore: 'default',
    method: 'sendNativeQuery',
    status: 'success',
    statement: 'SELECT ? AS value, ? AS count'
  })
  expect(JSON.stringify(result.queryTrace).includes('waterline-secret')).toBe(
    false
  )
  expect(JSON.stringify(result.queryTrace).includes('native-secret')).toBe(
    false
  )
})

test('Helm understands normal JavaScript syntax around return words', async ({
  sails,
  expect
}) => {
  const cases = [
    {
      source: '1 + 2',
      output: '3'
    },
    {
      source: `
const nested = () => {
  return 'nested'
}
nested()
`,
      output: 'nested'
    },
    {
      source: `
// return is only a comment
const text = 'return'
const matcher = /return/
matcher.test(text)
`,
      output: 'true'
    },
    {
      source: `
[1, 2, 3, 4]
  .map((number) => number * 2)
  .filter((number) => number > 4)
`,
      output: '[\n  6,\n  8\n]'
    },
    {
      source: `
({
  kind: 'object',
  nested: {
    ready: true
  }
});

// A trailing comment does not become the return target.
`,
      output: '{\n  "kind": "object",\n  "nested": {\n    "ready": true\n  }\n}'
    },
    {
      source: 'const subject = "Helm";\n`Hello ${subject}`',
      output: 'Hello Helm'
    }
  ]

  for (const example of cases) {
    const result = await runHelm(sails, example.source)
    expect(result.success).toBe(true)
    expect(result.output).toBe(example.output)
  }
})

test('Helm preserves explicit returns and leaves control statements undefined', async ({
  sails,
  expect
}) => {
  const explicitReturn = await runHelm(
    sails,
    `
if (true) {
  return { explicit: true }
}
return { explicit: false }
`
  )
  expect(explicitReturn.success).toBe(true)
  expect(explicitReturn.value).toEqual({ explicit: true })

  const statementCases = [
    'if (true) { const value = 1 }',
    'for (const value of [1, 2]) { void value }',
    'try { JSON.parse("{}") } catch (error) { void error }',
    '{ const value = 1; void value }',
    'const value = 1'
  ]

  for (const source of statementCases) {
    const result = await runHelm(sails, source)
    expect(result.success).toBe(true)
    expect(result.value).toEqual({ type: 'undefined' })
    expect(result.output).toBe('(no output)')
  }
})

test('Helm separates logs from the final value and safely snapshots rich values', async ({
  sails,
  expect
}) => {
  const result = await runHelm(
    sails,
    `
console.log('first', 1)
console.warn('second')
const value = {
  big: 42n,
  date: new Date('2026-07-28T12:00:00.000Z'),
  error: new Error('expected'),
  map: new Map([['answer', 42]]),
  set: new Set(['a', 'b']),
  toJSON() {
    throw new Error('must not run')
  }
}
const waterlineRecord = {
  email: 'builder@example.com',
  password: 'never expose this'
}
Object.defineProperty(waterlineRecord, 'toJSON', {
  value() {
    return { email: this.email }
  }
})
const brokenSerializer = { visible: true }
Object.defineProperty(brokenSerializer, 'toJSON', {
  value() {
    throw new Error('must fall back')
  }
})
Object.defineProperty(value, 'secret', {
  enumerable: true,
  get() {
    throw new Error('must not read')
  }
})
value.self = value
;({ value, waterlineRecord, brokenSerializer })
`
  )

  expect(result.success).toBe(true)
  expect(result.logs).toEqual(['first 1', 'second'])
  expect(result.value.value.big).toEqual({ type: 'BigInt', value: '42' })
  expect(result.value.value.date).toEqual({
    type: 'Date',
    value: '2026-07-28T12:00:00.000Z'
  })
  expect(result.value.value.error.type).toBe('Error')
  expect(result.value.value.map.type).toBe('Map')
  expect(result.value.value.set.type).toBe('Set')
  expect(result.value.value.toJSON).toEqual({
    type: 'Function',
    name: 'toJSON'
  })
  expect(result.value.value.secret).toBe('[Getter]')
  expect(result.value.value.self).toBe('[Circular ~2]')
  expect(result.value.waterlineRecord).toEqual({
    email: 'builder@example.com'
  })
  expect(result.value.brokenSerializer).toEqual({ visible: true })
  expect(result.output.startsWith('first 1\nsecond\n')).toBe(true)
})

test('Helm maps syntax and runtime failures to helm-input.js', async ({
  sails,
  expect
}) => {
  const syntaxFailure = await runHelm(sails, 'const broken =\n')
  expect(syntaxFailure.success).toBe(false)
  expect(syntaxFailure.error.name).toBe('SyntaxError')
  expect(syntaxFailure.error.filename).toBe('helm-input.js')
  expect(syntaxFailure.error.line).toBe(2)
  expect(syntaxFailure.error.column).toBe(1)
  expect(syntaxFailure.error.stack).toContain('helm-input.js:2:1')

  const runtimeFailure = await runHelm(
    sails,
    'const creator = null\ncreator.publicId'
  )
  expect(runtimeFailure.success).toBe(false)
  expect(runtimeFailure.error.name).toBe('TypeError')
  expect(runtimeFailure.error.filename).toBe('helm-input.js')
  expect(runtimeFailure.error.line).toBe(2)
  expect(runtimeFailure.error.column).toBe(9)
  expect(runtimeFailure.error.stack).toContain('helm-input.js:2:9')

  const inspectedFailure = await runHelm(
    sails,
    'const creator = null\ncreator.publicId // @inspect'
  )
  expect(inspectedFailure.success).toBe(false)
  expect(inspectedFailure.error.line).toBe(2)
  expect(inspectedFailure.error.column).toBe(9)
  expect(inspectedFailure.error.stack).toContain('helm-input.js:2:9')

  const rejectedPromise = await runHelm(
    sails,
    'await Promise.reject(new Error("rejected"))'
  )
  expect(rejectedPromise.success).toBe(false)
  expect(rejectedPromise.error.message).toBe('rejected')
  expect(rejectedPromise.error.filename).toBe('helm-input.js')
  expect(rejectedPromise.error.line).toBe(1)
})

test('Helm maps selected source failures back to the original editor', async ({
  sails,
  expect
}) => {
  const firstLineFailure = await runHelm(sails, 'null.publicId', {
    sourceStartLine: 12,
    sourceStartColumn: 5
  })
  expect(firstLineFailure.success).toBe(false)
  expect(firstLineFailure.error.filename).toBe('helm-input.js')
  expect(firstLineFailure.error.line).toBe(12)
  expect(firstLineFailure.error.column).toBe(10)
  expect(firstLineFailure.error.stack).toContain('helm-input.js:12:10')

  const laterLineFailure = await runHelm(
    sails,
    'const creator = null\ncreator.publicId',
    {
      sourceStartLine: 20,
      sourceStartColumn: 7
    }
  )
  expect(laterLineFailure.success).toBe(false)
  expect(laterLineFailure.error.filename).toBe('helm-input.js')
  expect(laterLineFailure.error.line).toBe(21)
  expect(laterLineFailure.error.column).toBe(9)
  expect(laterLineFailure.error.stack).toContain('helm-input.js:21:9')

  const syntaxFailure = await runHelm(sails, 'const = 1', {
    sourceStartLine: 30,
    sourceStartColumn: 4
  })
  expect(syntaxFailure.success).toBe(false)
  expect(syntaxFailure.error.filename).toBe('helm-input.js')
  expect(syntaxFailure.error.line).toBe(30)
  expect(syntaxFailure.error.column).toBe(10)
  expect(syntaxFailure.error.stack).toContain('helm-input.js:30:10')
})

test('Helm enforces synchronous, asynchronous, source, and output bounds', async ({
  sails,
  expect
}) => {
  for (const source of ['while (true) {}', 'await new Promise(() => {})']) {
    const startedAt = Date.now()
    const result = await runHelm(sails, source, { timeoutMs: 50 })

    expect(result.success).toBe(false)
    expect(result.error.name).toBe('TimeoutError')
    expect(result.error.code).toBe('HELM_TIMEOUT')
    expect(result.status).toBe('timeout')
    expect(Date.now() - startedAt < 2000).toBe(true)
  }

  const sourceFailure = await captureError(
    sails.helpers.helm.prepareSource.with({
      source: '12345',
      maxSourceBytes: 4
    })
  )
  expect(sourceFailure.code).toBe('HELM_SOURCE_INVALID')

  const oversized = await runHelm(sails, '"x".repeat(200000)')
  expect(oversized.success).toBe(true)
  expect(oversized.truncated).toBe(true)
  expect(oversized.value.type).toBe('truncated')
  expect(Buffer.byteLength(oversized.output) < 128 * 1024).toBe(true)
  expect(oversized.outputBytes).toBe(Buffer.byteLength(oversized.output))
})

test('Helm cancellation stops work and preserves bounded partial console output', async ({
  sails,
  expect
}) => {
  const controller = new AbortController()
  const operation = runHelm(
    sails,
    `
console.log('before cancellation')
await new Promise(() => {})
`,
    { signal: controller.signal, timeoutMs: 5000 }
  )

  setTimeout(() => {
    const error = new Error('Helm execution was cancelled by the user.')
    error.name = 'CancelledError'
    error.code = 'HELM_CANCELLED'
    controller.abort(error)
  }, 100)

  const result = await operation

  expect(result.success).toBe(false)
  expect(result.status).toBe('cancelled')
  expect(result.error.code).toBe('HELM_CANCELLED')
  expect(result.logs).toEqual(['before cancellation'])
  expect(result.logsPartial).toBe(true)
  expect(result.output).toBe('before cancellation')
  expect(result.outputBytes).toBe(Buffer.byteLength(result.output))
  expect(result.durationMs < 2000).toBe(true)

  const synchronousController = new AbortController()
  const synchronousOperation = runHelm(
    sails,
    "console.log('before loop')\nwhile (true) {}",
    {
      signal: synchronousController.signal,
      timeoutMs: 5000
    }
  )
  setTimeout(() => {
    const error = new Error('Helm execution was cancelled by the user.')
    error.name = 'CancelledError'
    error.code = 'HELM_CANCELLED'
    synchronousController.abort(error)
  }, 100)

  const synchronousResult = await synchronousOperation
  expect(synchronousResult.status).toBe('cancelled')
  expect(synchronousResult.logs).toEqual(['before loop'])
  expect(synchronousResult.durationMs < 2000).toBe(true)
})

test('project Helm and Bosun Helm delegate to the same bounded runner', async ({
  sails,
  expect
}) => {
  const originalRun = sails.helpers.helm.run
  const calls = []
  const fakeRun = async (options) => {
    calls.push(options)
    return { success: true, output: 'ready' }
  }
  fakeRun.with = fakeRun
  sails.helpers.helm.run = fakeRun

  try {
    const bosunResult = await sails.helpers.helm.evaluate('1 + 1', 4, 2)
    const projectResult = await sails.helpers.helm.executeInContainer(
      'web-production',
      '1 + 1',
      8,
      3,
      '3f759945-d02c-4e39-a468-189462be6a87'
    )

    expect(bosunResult.output).toBe('ready')
    expect(projectResult.output).toBe('ready')
    expect(calls[0].command).toBe(process.execPath)
    expect(calls[0].source).toBe('1 + 1')
    expect(calls[0].sourceStartLine).toBe(4)
    expect(calls[0].sourceStartColumn).toBe(2)
    expect(calls[0].bootstrapSails).toBe(true)
    expect(calls[1].args).toEqual([
      'exec',
      '-i',
      '-e',
      'SLIPWAY_HELM_EXECUTION_ID=3f759945-d02c-4e39-a468-189462be6a87',
      'web-production',
      'node'
    ])
    expect(calls[1].source).toBe('1 + 1')
    expect(calls[1].sourceStartLine).toBe(8)
    expect(calls[1].sourceStartColumn).toBe(3)
    expect(calls[1].bootstrapSails).toBe(true)
  } finally {
    sails.helpers.helm.run = originalRun
  }
})

test('project Helm cancellation also stops the exact container execution', async ({
  sails,
  expect
}) => {
  const originalRun = sails.helpers.helm.run
  const originalStop = sails.helpers.helm.stopContainerExecution
  const runCalls = []
  const stopCalls = []
  const fakeRun = async (options) => {
    runCalls.push(options)
    return {
      success: false,
      status: 'cancelled',
      error: { code: 'HELM_CANCELLED' }
    }
  }
  const fakeStop = async (options) => {
    stopCalls.push(options)
    return true
  }
  fakeRun.with = fakeRun
  fakeStop.with = fakeStop
  sails.helpers.helm.run = fakeRun
  sails.helpers.helm.stopContainerExecution = fakeStop
  const controller = new AbortController()
  const error = new Error('cancelled')
  error.code = 'HELM_CANCELLED'
  controller.abort(error)

  try {
    const result = await sails.helpers.helm.executeInContainer.with({
      containerName: 'web-production',
      source: 'while (true) {}',
      executionId: 'e8788ac1-6bda-4226-953d-4842423a9516',
      signal: controller.signal
    })

    expect(result.status).toBe('cancelled')
    expect(runCalls[0].signal).toBe(controller.signal)
    expect(stopCalls).toEqual([
      {
        containerName: 'web-production',
        executionId: 'e8788ac1-6bda-4226-953d-4842423a9516'
      }
    ])
  } finally {
    sails.helpers.helm.run = originalRun
    sails.helpers.helm.stopContainerExecution = originalStop
  }
})

async function runHelm(sails, source, options = {}) {
  return sails.helpers.helm.run.with({
    command: process.execPath,
    source,
    bootstrapSails: false,
    ...options
  })
}

async function captureError(operation) {
  try {
    await operation
  } catch (error) {
    return error
  }

  throw new Error('Expected operation to fail.')
}
