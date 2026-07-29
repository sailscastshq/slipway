const { test } = require('sounding')

test('Helm mutation classification ignores reads, strings, and comments', ({
  sails,
  expect
}) => {
  const result = sails.helpers.helm.classifyMutations(`
// Creator.destroy() is documentation, not a call.
const example = "await Creator.updateOne({ id: 1 })"
await Creator.find({ isActive: true })
`)

  expect(result.complete).toBe(true)
  expect(result.mutating).toBe(false)
  expect(result.findings).toEqual([])
})

test('Helm mutation classification reports obvious model writes with source locations', ({
  sails,
  expect
}) => {
  const result = sails.helpers.helm.classifyMutations(`
await Creator.create({ email: 'grace@example.com' })
await Creator.updateOne({ id: 1 }).set({ isActive: false })
await Creator.destroy({ isActive: false })
`)

  expect(result.complete).toBe(true)
  expect(result.mutating).toBe(true)
  expect(result.findings.map((finding) => finding.method)).toEqual([
    'create',
    'updateOne',
    'destroy'
  ])
  expect(result.findings[0].line).toBe(2)
  expect(result.findings[0].kind).toBe('database-write')
})

test('Helm mutation classification catches native queries and recognizable external side effects', ({
  sails,
  expect
}) => {
  const result = sails.helpers.helm.classifyMutations(`
await sails.getDatastore().sendNativeQuery('DELETE FROM creators')
await fetch('https://example.com/webhook', { method: 'POST' })
await sails.helpers.mail.sendTemplate.with({ to: 'builder@example.com' })
`)

  expect(result.mutating).toBe(true)
  expect(result.findings.map((finding) => finding.kind)).toEqual([
    'native-query',
    'external-side-effect',
    'external-side-effect'
  ])
  expect(result.findings.map((finding) => finding.method)).toEqual([
    'sendNativeQuery',
    'fetch',
    'sendTemplate'
  ])
})

test('Helm mutation classification remains explicitly incomplete when source cannot be parsed', ({
  sails,
  expect
}) => {
  const result = sails.helpers.helm.classifyMutations(
    'await Creator.updateOne({'
  )

  expect(result.complete).toBe(false)
  expect(result.mutating).toBe(false)
  expect(result.findings).toEqual([])
  expect(result.parserError.line >= 1).toBe(true)
})

test('Helm source hashing is stable without storing submitted source', ({
  sails,
  expect
}) => {
  const source = 'await Creator.find()'
  const first = sails.helpers.helm.hashSource(source)
  const second = sails.helpers.helm.hashSource(source)

  expect(first).toBe(second)
  expect(first.length).toBe(64)
  expect(first.includes(source)).toBe(false)
  expect(sails.helpers.helm.hashSource(`${source}\n`) === first).toBe(false)
})
