const assert = require('node:assert/strict')
const { test } = require('sounding')
const {
  assertRecoveryExecution
} = require('../../fixtures/quest-resident/recovery.cjs')

const running = () => ({
  sequence: 100,
  requestedAt: 1792436170111,
  startedAt: 1792436170111,
  finishedAt: null,
  exitCode: null,
  result: { status: 'unavailable' }
})

test('Resident recovery trial permits live log progress while preserving exact execution evidence', () => {
  const original = running()
  let sequence = original.sequence
  for (const [state, next] of [
    ['unconfirmed', 100],
    ['running', 101],
    ['unconfirmed', 101],
    ['running', 102]
  ]) {
    sequence = assertRecoveryExecution(
      { ...original, state, sequence: next, stdout: 'New live output' },
      original,
      sequence
    )
    assert.equal(sequence, next)
  }
  assert.throws(() =>
    assertRecoveryExecution({ ...original, sequence: 101 }, original, sequence)
  )
  for (const sequence of [NaN, undefined, '103', 102.5]) {
    assert.throws(() =>
      assertRecoveryExecution({ ...original, sequence }, original, 102)
    )
  }
})

test('Resident recovery trial rejects invented execution timestamps, outcomes and results even with a newer sequence', () => {
  const original = running()
  for (const change of [
    { requestedAt: original.requestedAt + 1 },
    { startedAt: original.startedAt + 1 },
    { finishedAt: original.startedAt + 100 },
    { exitCode: 0 },
    { result: { status: 'available', value: 'invented' } }
  ]) {
    assert.throws(() =>
      assertRecoveryExecution(
        { ...original, sequence: 101, ...change },
        original,
        original.sequence
      )
    )
  }
})
