const { test } = require('sounding')
const assert = require('node:assert/strict')

async function fixture(fetchDefaults, initial = {}) {
  const { createDependentDefaults } = await import(
    '../../../assets/js/lib/bridge/dependent-defaults.mjs'
  )
  const values = {
    event: 'event-1',
    proposal: 'proposal-1',
    title: '',
    speaker: '',
    track: '',
    ...initial
  }
  const state = { errors: 0, pending: false }
  const defaults = createDependentDefaults({
    provider: {
      dependsOn: ['event', 'proposal'],
      fields: ['title', 'speaker', 'track']
    },
    getValues: () => values,
    applyValues: (patch) => Object.assign(values, patch),
    emptyValue: () => '',
    fetchDefaults,
    onError: () => state.errors++,
    onPending: (pending) => {
      state.pending = pending
    }
  })
  return { defaults, values, state }
}

test('Dependent defaults fill blank fields, replace automatic suggestions and preserve manual edits or clears', async () => {
  const f = await fixture(async (values) => ({
    values: { title: values.proposal, speaker: 'Ada', track: 'Main' }
  }))
  await f.defaults.refresh()
  assert.equal(f.values.title, 'proposal-1')
  f.values.proposal = 'proposal-2'
  await f.defaults.refresh()
  assert.equal(f.values.title, 'proposal-2')
  f.defaults.markEdited('title')
  f.values.title = 'Sponsor introduction'
  f.defaults.markEdited('speaker')
  f.values.speaker = ''
  f.values.proposal = 'proposal-3'
  await f.defaults.refresh()
  assert.equal(f.values.title, 'Sponsor introduction')
  assert.equal(f.values.speaker, '')
  assert.equal(f.values.track, 'Main')
  f.values.proposal = ''
  await f.defaults.refresh()
  assert.equal(f.values.track, '')
  assert.equal(f.values.title, 'Sponsor introduction')
})

test('Dependent defaults ignore stale event and selection responses, including providers that ignore abort', async () => {
  const requests = []
  const f = await fixture(
    (values, signal) =>
      new Promise((resolve) => requests.push({ values, signal, resolve }))
  )
  const a = f.defaults.refresh()
  f.values.event = 'event-2'
  f.values.proposal = 'proposal-2'
  const b = f.defaults.refresh()
  assert(requests[0].signal.aborted)
  f.defaults.markEdited('speaker')
  f.values.speaker = 'Manual speaker'
  requests[1].resolve({ values: { title: 'New event', speaker: 'Automatic' } })
  await b
  requests[0].resolve({ values: { title: 'Stale event' } })
  await a
  assert.equal(f.values.title, 'New event')
  assert.equal(f.values.speaker, 'Manual speaker')
  assert.equal(f.state.pending, false)
  const c = f.defaults.refresh()
  f.values.event = ''
  const clear = f.defaults.refresh()
  requests[2].resolve({ values: { title: 'Late response after clear' } })
  await Promise.all([c, clear])
  assert.equal(f.values.title, '')
  assert.equal(f.state.errors, 0)
})

test('Dependent defaults preserve existing record values, allow manual fallback and abort on disposal', async () => {
  let resolve
  const f = await fixture(
    () =>
      new Promise((r) => {
        resolve = r
      }),
    { title: 'Existing title' }
  )
  const pending = f.defaults.refresh()
  f.defaults.dispose()
  resolve({ values: { title: 'New', track: 'Main' } })
  await pending
  assert.equal(f.values.title, 'Existing title')
  assert.equal(f.values.track, '')
  assert.equal(f.state.pending, false)
  const failing = await fixture(async () => {
    throw new Error('Unavailable')
  })
  await failing.defaults.refresh()
  assert.equal(failing.state.errors, 1)
  assert.equal(failing.state.pending, false)
})
