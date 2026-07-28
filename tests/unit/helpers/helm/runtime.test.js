const { test } = require('sounding')

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
  expect(syntaxFailure.error.line).toBe(2)
  expect(syntaxFailure.error.column).toBe(1)
  expect(syntaxFailure.error.stack).toContain('helm-input.js:2:1')

  const runtimeFailure = await runHelm(
    sails,
    'const creator = null\ncreator.publicId'
  )
  expect(runtimeFailure.success).toBe(false)
  expect(runtimeFailure.error.name).toBe('TypeError')
  expect(runtimeFailure.error.line).toBe(2)
  expect(runtimeFailure.error.column).toBe(9)
  expect(runtimeFailure.error.stack).toContain('helm-input.js:2:9')

  const rejectedPromise = await runHelm(
    sails,
    'await Promise.reject(new Error("rejected"))'
  )
  expect(rejectedPromise.success).toBe(false)
  expect(rejectedPromise.error.message).toBe('rejected')
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
  expect(laterLineFailure.error.line).toBe(21)
  expect(laterLineFailure.error.column).toBe(9)
  expect(laterLineFailure.error.stack).toContain('helm-input.js:21:9')

  const syntaxFailure = await runHelm(sails, 'const = 1', {
    sourceStartLine: 30,
    sourceStartColumn: 4
  })
  expect(syntaxFailure.success).toBe(false)
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
      3
    )

    expect(bosunResult.output).toBe('ready')
    expect(projectResult.output).toBe('ready')
    expect(calls[0].command).toBe(process.execPath)
    expect(calls[0].source).toBe('1 + 1')
    expect(calls[0].sourceStartLine).toBe(4)
    expect(calls[0].sourceStartColumn).toBe(2)
    expect(calls[0].bootstrapSails).toBe(true)
    expect(calls[1].args).toEqual(['exec', '-i', 'web-production', 'node'])
    expect(calls[1].source).toBe('1 + 1')
    expect(calls[1].sourceStartLine).toBe(8)
    expect(calls[1].sourceStartColumn).toBe(3)
    expect(calls[1].bootstrapSails).toBe(true)
  } finally {
    sails.helpers.helm.run = originalRun
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
