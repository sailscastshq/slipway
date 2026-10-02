const assert = require('node:assert/strict')
const { test } = require('sounding')

function fakeClock() {
  let now = 0
  let nextId = 0
  const timers = new Map()
  return {
    setTimer(fn, delay) {
      const id = ++nextId
      timers.set(id, { fn, at: now + delay })
      return id
    },
    clearTimer(id) {
      timers.delete(id)
    },
    tick(duration) {
      const until = now + duration
      while (true) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0]
        if (!next || next[1].at > until) break
        now = next[1].at
        timers.delete(next[0])
        next[1].fn()
      }
      now = until
    },
    count: () => timers.size
  }
}

async function persistenceFixture() {
  const { createHelmScratchpadPersistence } = await import(
    '../../../assets/js/lib/helmScratchpadPersistence.mjs'
  )
  const clock = fakeClock()
  const writes = []
  const errors = []
  let state = { source: '' }
  let serializations = 0
  let unavailable = false
  const persistence = createHelmScratchpadPersistence({
    readState: () => state,
    serialize: (value) => {
      serializations++
      return JSON.stringify(value)
    },
    writeState: (serialized) => {
      if (unavailable) throw new Error('Storage full')
      writes.push(JSON.parse(serialized))
    },
    onError: (error) => errors.push(error.message),
    ...clock
  })
  return {
    persistence,
    clock,
    writes,
    errors,
    serializations: () => serializations,
    unavailable: (value) => (unavailable = value),
    update: (value) => {
      state = value
      persistence.schedule()
    }
  }
}

test('Helm autosave coalesces typing without serializing on the input path', async () => {
  const fixture = await persistenceFixture()
  for (let index = 0; index < 10; index++) {
    fixture.update({ source: `edit ${index}` })
  }
  assert.equal(fixture.serializations(), 0)
  assert.equal(fixture.writes.length, 0)
  assert.equal(fixture.clock.count(), 2)
  fixture.clock.tick(249)
  assert.equal(fixture.writes.length, 0)
  fixture.clock.tick(1)
  assert.deepEqual(fixture.writes, [{ source: 'edit 9' }])
  assert.equal(fixture.serializations(), 1)
  assert.equal(fixture.clock.count(), 0)
})

test('Helm autosave bounds continuous typing to one second and restarts cleanly', async () => {
  const fixture = await persistenceFixture()
  for (let index = 0; index < 10; index++) {
    fixture.update({ source: `edit ${index}` })
    fixture.clock.tick(100)
  }
  assert.deepEqual(fixture.writes, [{ source: 'edit 9' }])
  assert.equal(fixture.clock.count(), 0)
  fixture.update({ source: 'next burst' })
  fixture.clock.tick(250)
  assert.deepEqual(fixture.writes.at(-1), { source: 'next burst' })
})

test('Helm lifecycle flush reads the latest state and clears queued saves', async () => {
  const fixture = await persistenceFixture()
  fixture.update({ tabs: [{ source: 'old' }] })
  fixture.update({ tabs: [] })
  assert.equal(fixture.persistence.flush(), true)
  assert.deepEqual(fixture.writes, [{ tabs: [] }])
  fixture.clock.tick(2000)
  assert.equal(fixture.writes.length, 1)
  assert.equal(fixture.persistence.flush(), true)
  assert.equal(fixture.serializations(), 1)
})

test('Helm explicit save remains synchronous and does not discard pending edits on failure', async () => {
  const fixture = await persistenceFixture()
  fixture.update({ source: 'latest edit', name: 'Original' })
  fixture.unavailable(true)
  assert.equal(
    fixture.persistence.save({ source: 'latest edit', name: 'Unsaved rename' }),
    false
  )
  assert.deepEqual(fixture.errors, ['Storage full'])
  fixture.unavailable(false)
  fixture.clock.tick(250)
  assert.deepEqual(fixture.writes, [
    { source: 'latest edit', name: 'Original' }
  ])
  assert.equal(
    fixture.persistence.save({ source: 'latest edit', name: 'Saved rename' }),
    true
  )
  assert.equal(fixture.writes.at(-1).name, 'Saved rename')
  fixture.clock.tick(1000)
  assert.equal(fixture.writes.length, 2)
})

test('Helm failed autosave retries on a later flush without looping or losing edits', async () => {
  const fixture = await persistenceFixture()
  fixture.unavailable(true)
  fixture.update({ source: 'keep me' })
  fixture.clock.tick(1000)
  assert.equal(fixture.errors.length, 1)
  assert.equal(fixture.clock.count(), 0)
  fixture.unavailable(false)
  assert.equal(fixture.persistence.flush(), true)
  assert.deepEqual(fixture.writes, [{ source: 'keep me' }])
})

async function workspaceFixture(run) {
  const { effectScope } = await import('vue')
  const { useHelmScratchpads } = await import(
    '../../../assets/js/composables/useHelmScratchpads.js'
  )
  const previousWindow = global.window
  const previousDocument = global.document
  const previousWarn = console.warn
  const scope = effectScope()
  let stored = null
  let unavailable = false
  let writes = 0
  global.window = new EventTarget()
  global.document = new EventTarget()
  document.visibilityState = 'visible'
  window.localStorage = {
    getItem: () => stored,
    setItem: (key, value) => {
      assert.equal(key, 'slipway:helm-scratchpads')
      if (unavailable) throw new Error('Storage full')
      writes++
      stored = value
    }
  }
  console.warn = () => {}
  try {
    const target = {
      project: { id: 'project', name: 'Project', slug: 'project' },
      environment: { id: 'staging', name: 'Staging', slug: 'staging' },
      app: { id: 'web', name: 'Web', slug: 'web' }
    }
    const workspace = scope.run(() => useHelmScratchpads(target))
    await run({
      workspace,
      scope,
      stored: () => JSON.parse(stored),
      writes: () => writes,
      unavailable: (value) => (unavailable = value)
    })
  } finally {
    scope.stop()
    global.window = previousWindow
    global.document = previousDocument
    console.warn = previousWarn
  }
}

test('Helm workspace flushes current source on pagehide, visibility loss, and disposal', async () => {
  await workspaceFixture(({ workspace, scope, stored, writes }) => {
    const initialWrites = writes()
    const tabId = workspace.activeId.value
    for (let index = 0; index < 20; index++) {
      workspace.code.value = `edit ${index}`
    }
    workspace.result.value = { value: 'never persist this result' }
    workspace.error.value = 'never persist this error'
    assert.equal(writes(), initialWrites)
    window.dispatchEvent(new Event('pagehide'))
    assert.equal(
      stored().tabs.find((tab) => tab.id === tabId).source,
      'edit 19'
    )
    assert.equal(writes(), initialWrites + 1)
    assert.ok(!JSON.stringify(stored()).includes('never persist'))
    workspace.code.value = 'hidden edit'
    document.visibilityState = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    assert.equal(stored().tabs[0].source, 'hidden edit')
    workspace.code.value = 'navigation edit'
    scope.stop()
    assert.equal(stored().tabs[0].source, 'navigation edit')
    const finalWrites = writes()
    window.dispatchEvent(new Event('pagehide'))
    assert.equal(writes(), finalWrites)
  })
})

test('Helm workspace preserves immediate rename confirmation, tab changes, and deletion', async () => {
  await workspaceFixture(({ workspace, stored, unavailable }) => {
    const originalId = workspace.activeId.value
    workspace.code.value = 'original pending source'
    const copy = workspace.duplicate(originalId)
    assert.equal(stored().tabs.length, 2)
    assert.equal(stored().tabs[1].source, 'original pending source')
    assert.equal(workspace.activeId.value, copy.id)
    workspace.code.value = 'copy pending source'
    workspace.view.value = 'tree'
    assert.equal(stored().tabs[1].view, 'tree')
    assert.equal(stored().tabs[1].source, 'copy pending source')
    workspace.markCurrentSourceSaved()
    assert.equal(stored().tabs[1].baselineSource, 'copy pending source')
    assert.equal(workspace.rename(copy.id, 'Saved copy'), 'saved')
    assert.equal(stored().tabs[1].name, 'Saved copy')
    assert.equal(stored().tabs[1].source, 'copy pending source')
    assert.equal(workspace.rename(copy.id, 'Saved copy'), 'unchanged')
    unavailable(true)
    workspace.code.value = 'pending after failure'
    assert.equal(workspace.rename(copy.id, 'Rejected'), 'failed')
    assert.equal(workspace.activeTab.value.name, 'Saved copy')
    unavailable(false)
    workspace.activate(originalId)
    assert.equal(stored().tabs[1].source, 'pending after failure')
    workspace.move(copy.id, -1)
    assert.equal(stored().tabs[0].id, copy.id)
    workspace.code.value = 'delete pending source'
    workspace.close(originalId)
    workspace.close(copy.id)
    assert.deepEqual(stored().tabs, [])
    window.dispatchEvent(new Event('pagehide'))
    assert.deepEqual(stored().tabs, [])
    assert.equal(stored().activeByTarget['project:staging:web'], '')
  })
})
