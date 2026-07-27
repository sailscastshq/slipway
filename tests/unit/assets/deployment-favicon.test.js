const { test } = require('sounding')

test('deployment favicon resolves aggregate state without hiding active work', async ({
  expect
}) => {
  const { resolveDeploymentFaviconState } = await import(
    '../../../assets/js/lib/deployment-favicon.mjs'
  )

  expect(resolveDeploymentFaviconState()).toBe('idle')
  expect(
    resolveDeploymentFaviconState({
      activeStatuses: ['building'],
      terminalStates: ['failed']
    })
  ).toBe('deploying')
  expect(
    resolveDeploymentFaviconState({
      terminalStates: ['success', 'cancelled', 'failed']
    })
  ).toBe('failed')
  expect(
    resolveDeploymentFaviconState({
      terminalStates: ['success', 'cancelled']
    })
  ).toBe('cancelled')
})

test('deployment favicon moves from active to success and restores the original icon', async ({
  expect
}) => {
  const { createDeploymentFaviconManager } = await import(
    '../../../assets/js/lib/deployment-favicon.mjs'
  )
  const documentRef = createFakeDocument('/images/custom-favicon.svg')
  const timers = createFakeTimers()
  const favicon = createDeploymentFaviconManager({
    documentRef,
    setTimeoutFn: timers.set,
    clearTimeoutFn: timers.clear,
    terminalDurations: {
      success: 100,
      failed: 120,
      cancelled: 120
    }
  })

  expect(documentRef.icon.getAttribute('href')).toBe(
    '/images/custom-favicon.svg'
  )
  expect(documentRef.icon.dataset.deploymentState).toBe('idle')

  favicon.replaceActiveDeployments([{ id: 7, status: 'building' }])
  expect(favicon.getState()).toBe('deploying')
  expect(documentRef.icon.getAttribute('href')).toBe(
    '/images/favicon-deploying.svg'
  )

  favicon.noteDeploymentStatus(7, 'running')
  expect(favicon.getState()).toBe('success')
  expect(documentRef.icon.getAttribute('href')).toBe(
    '/images/favicon-success.svg'
  )

  timers.runNext()
  expect(favicon.getState()).toBe('idle')
  expect(documentRef.icon.getAttribute('href')).toBe(
    '/images/custom-favicon.svg'
  )
})

test('deployment favicon keeps active work visible and preserves the most important terminal state', async ({
  expect
}) => {
  const { createDeploymentFaviconManager } = await import(
    '../../../assets/js/lib/deployment-favicon.mjs'
  )
  const documentRef = createFakeDocument()
  const timers = createFakeTimers()
  const favicon = createDeploymentFaviconManager({
    documentRef,
    setTimeoutFn: timers.set,
    clearTimeoutFn: timers.clear,
    terminalDurations: {
      success: 100,
      failed: 120,
      cancelled: 120
    }
  })

  favicon.replaceActiveDeployments([
    { id: 1, status: 'deploying' },
    { id: 2, status: 'building' }
  ])
  favicon.noteDeploymentStatus(1, 'failed')
  expect(favicon.getState()).toBe('deploying')

  favicon.replaceActiveDeployments([
    { id: 1, status: 'building' },
    { id: 2, status: 'building' }
  ])
  favicon.noteDeploymentStatus(2, 'running')
  expect(favicon.getState()).toBe('failed')
  expect(documentRef.icon.getAttribute('href')).toBe(
    '/images/favicon-failed.svg'
  )

  timers.runByDelay(120)
  expect(favicon.getState()).toBe('success')

  timers.runByDelay(100)
  expect(favicon.getState()).toBe('idle')
})

test('deployment favicon reset clears terminal timers and restores idle state', async ({
  expect
}) => {
  const { createDeploymentFaviconManager } = await import(
    '../../../assets/js/lib/deployment-favicon.mjs'
  )
  const documentRef = createFakeDocument()
  const timers = createFakeTimers()
  const favicon = createDeploymentFaviconManager({
    documentRef,
    setTimeoutFn: timers.set,
    clearTimeoutFn: timers.clear
  })

  favicon.noteDeploymentStatus(9, 'cancelled')
  expect(favicon.getState()).toBe('cancelled')
  expect(timers.size()).toBe(1)

  favicon.reset()
  expect(favicon.getState()).toBe('idle')
  expect(timers.size()).toBe(0)
  expect(documentRef.icon.getAttribute('href')).toBe('/images/favicon.svg')
})

test('deployment favicon acknowledgement clears terminal results without hiding active work', async ({
  expect
}) => {
  const { createDeploymentFaviconManager } = await import(
    '../../../assets/js/lib/deployment-favicon.mjs'
  )
  const documentRef = createFakeDocument()
  const timers = createFakeTimers()
  const favicon = createDeploymentFaviconManager({
    documentRef,
    setTimeoutFn: timers.set,
    clearTimeoutFn: timers.clear
  })

  favicon.replaceActiveDeployments([{ id: 10, status: 'deploying' }])
  favicon.noteDeploymentStatus(9, 'failed')
  expect(favicon.getState()).toBe('deploying')
  expect(timers.size()).toBe(1)

  favicon.acknowledgeTerminalStates()
  expect(favicon.getState()).toBe('deploying')
  expect(timers.size()).toBe(0)

  favicon.replaceActiveDeployments([])
  expect(favicon.getState()).toBe('idle')
})

function createFakeDocument(initialHref = '/images/favicon.svg') {
  let icon = createFakeLink(initialHref)

  return {
    get icon() {
      return icon
    },
    querySelector() {
      return icon
    },
    createElement() {
      return createFakeLink(null)
    },
    head: {
      appendChild(element) {
        icon = element
      }
    }
  }
}

function createFakeLink(href) {
  const attributes = new Map([
    ['rel', 'icon'],
    ['type', 'image/svg+xml']
  ])
  if (href) attributes.set('href', href)

  return {
    dataset: {},
    getAttribute(name) {
      return attributes.get(name) || null
    },
    setAttribute(name, value) {
      attributes.set(name, value)
    }
  }
}

function createFakeTimers() {
  let nextId = 1
  const scheduled = new Map()

  return {
    set(callback, delay) {
      const id = nextId++
      scheduled.set(id, { callback, delay })
      return id
    },
    clear(id) {
      scheduled.delete(id)
    },
    runNext() {
      const [id, timer] = scheduled.entries().next().value || []
      if (!timer) return
      scheduled.delete(id)
      timer.callback()
    },
    runByDelay(delay) {
      const match = [...scheduled.entries()].find(
        ([, timer]) => timer.delay === delay
      )
      if (!match) return

      const [id, timer] = match
      scheduled.delete(id)
      timer.callback()
    },
    size() {
      return scheduled.size
    }
  }
}
