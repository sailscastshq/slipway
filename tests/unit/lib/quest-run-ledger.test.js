const assert = require('node:assert/strict')
const { test } = require('sounding')
const ledger = require('../../../api/lib/quest-run-ledger')

test('Quest redacts nested structured payloads and diagnostic secrets before storing', () => {
  const options = { environment: { DATABASE_PASSWORD: 'private-secret-value' } }
  const value = ledger.sanitizeValue(
    {
      password: 'private',
      nested: [
        { ok: '\u001b[31mhello\u001b[0m private-secret-value Bearer xyz' }
      ],
      credential: 'secret'
    },
    options
  )
  assert.equal(value.password, '<redacted>')
  assert.equal(value.credential, '<redacted>')
  assert.equal(value.nested[0].ok, 'hello <redacted> Bearer <redacted>')
  assert.equal(
    ledger.boundedText('TOKEN=visible', 100).value,
    'TOKEN=<redacted>'
  )
})

test('Quest result envelopes preserve falsy values and distinguish serialization outcomes', () => {
  for (const value of [
    null,
    false,
    0,
    '',
    '  exact  ',
    '\n\t',
    [],
    { data: 'ok' }
  ]) {
    assert.deepEqual(
      JSON.parse(
        JSON.stringify(ledger.resultEnvelope({ status: 'available', value }))
      ),
      { status: 'available', value }
    )
  }
  assert.equal(
    ledger.resultEnvelope({ status: 'available', value: undefined }).status,
    'undefined'
  )
  assert.equal(
    ledger.resultEnvelope({ status: 'available', value: 12n }).status,
    'unsupported'
  )
  assert.equal(
    ledger.resultEnvelope({ status: 'available', value: new Date() }).status,
    'unsupported'
  )
  const cycle = {}
  cycle.self = cycle
  assert.equal(
    ledger.resultEnvelope({ status: 'available', value: cycle }).status,
    'serialization_error'
  )
  const accessor = Object.defineProperty({}, 'unsafe', {
    enumerable: true,
    get() {
      throw new Error('must not execute')
    }
  })
  assert.equal(
    ledger.resultEnvelope({ status: 'available', value: accessor }).status,
    'serialization_error'
  )
  assert.deepEqual(
    ledger.resultEnvelope({ status: 'available', value: '💛'.repeat(40000) }),
    { status: 'too_large', truncated: true }
  )
  let deep = {}
  for (let i = 0; i < 20; i++) deep = { child: deep }
  assert.equal(
    ledger.resultEnvelope({ status: 'available', value: deep }).status,
    'too_large'
  )
  assert.equal(
    ledger.resultEnvelope({ status: 'available', value: Array(5000).fill(1) })
      .status,
    'too_large'
  )
  assert.deepEqual(
    ledger.resultEnvelope({ status: 'unavailable', value: 'not a result' }),
    { status: 'unavailable' }
  )
})

test('Quest log bounds count UTF-8 bytes without broken codepoints', () => {
  for (let budget = 1; budget < 10; budget++) {
    const bounded = ledger.boundedText('🙂'.repeat(20), budget)
    assert.equal(bounded.truncated, true)
    assert.ok(Buffer.byteLength(bounded.value) <= budget)
    assert.equal(bounded.value.includes('\ufffd'), false)
  }
})
