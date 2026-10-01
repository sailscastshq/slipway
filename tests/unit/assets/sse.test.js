const { test } = require('sounding')

test('closing an SSE stream cancels its pending reconnect', async ({
  expect
}) => {
  const originalEventSource = global.EventSource
  const instances = []

  class TestEventSource {
    constructor(url) {
      this.url = url
      instances.push(this)
    }

    close() {
      this.closed = true
    }
  }

  global.EventSource = TestEventSource

  try {
    const [{ effectScope }, { useEventSource }] = await Promise.all([
      import('vue'),
      import('../../../assets/js/composables/sse.js')
    ])
    const scope = effectScope()
    let stream
    scope.run(() => {
      stream = useEventSource('/events', { reconnectDelay: 5 })
    })

    instances[0].onerror()
    scope.stop()
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(instances.length).toBe(1)
    expect(instances[0].closed).toBe(true)
  } finally {
    global.EventSource = originalEventSource
  }
})

test('optional live streams pause when hidden and resume without leaking reconnects', async ({
  expect
}) => {
  const originalEventSource = global.EventSource
  const originalDocument = global.document
  const originalWindow = global.window
  const documentEvents = new EventTarget()
  documentEvents.hidden = true
  global.document = documentEvents
  global.window = new EventTarget()
  const instances = []
  global.EventSource = class {
    constructor(url) {
      this.url = url
      instances.push(this)
    }
    close() {
      this.closed = true
    }
  }
  let scope
  try {
    const [{ effectScope }, { useEventSource }] = await Promise.all([
      import('vue'),
      import('../../../assets/js/composables/sse.js')
    ])
    scope = effectScope()
    let stream
    let messages = 0
    scope.run(() => {
      stream = useEventSource('/live', {
        pauseWhenHidden: true,
        reconnectDelay: 5,
        onMessage: () => messages++
      })
    })
    expect(instances.length).toBe(0)
    documentEvents.hidden = false
    documentEvents.dispatchEvent(new Event('visibilitychange'))
    expect(instances.length).toBe(1)
    instances[0].onerror()
    documentEvents.hidden = true
    documentEvents.dispatchEvent(new Event('visibilitychange'))
    documentEvents.dispatchEvent(new Event('visibilitychange'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(instances.length).toBe(1)
    expect(instances[0].closed).toBe(true)
    documentEvents.hidden = false
    documentEvents.dispatchEvent(new Event('visibilitychange'))
    documentEvents.dispatchEvent(new Event('visibilitychange'))
    expect(instances.length).toBe(2)
    instances[0].onmessage({ data: '{"metrics":[]}' })
    expect(messages).toBe(0)
    instances[1].onmessage({ data: '{"metrics":[]}' })
    expect(messages).toBe(1)
    stream.close()
    documentEvents.hidden = true
    documentEvents.dispatchEvent(new Event('visibilitychange'))
    documentEvents.hidden = false
    documentEvents.dispatchEvent(new Event('visibilitychange'))
    expect(instances.length).toBe(2)
    stream.connect()
    expect(instances.length).toBe(3)
    scope.stop()
    documentEvents.hidden = true
    documentEvents.dispatchEvent(new Event('visibilitychange'))
    documentEvents.hidden = false
    documentEvents.dispatchEvent(new Event('visibilitychange'))
    expect(instances.length).toBe(3)
    expect(instances[2].closed).toBe(true)
  } finally {
    scope?.stop()
    global.EventSource = originalEventSource
    global.document = originalDocument
    global.window = originalWindow
  }
})

test('ordinary streams keep their continuity when the tab is hidden', async ({
  expect
}) => {
  const originalEventSource = global.EventSource
  const originalDocument = global.document
  const documentEvents = new EventTarget()
  documentEvents.hidden = true
  global.document = documentEvents
  const instances = []
  global.EventSource = class {
    constructor() {
      instances.push(this)
    }
    close() {
      this.closed = true
    }
  }
  let scope
  try {
    const [{ effectScope }, { useEventSource }] = await Promise.all([
      import('vue'),
      import('../../../assets/js/composables/sse.js')
    ])
    scope = effectScope()
    scope.run(() => useEventSource('/execution'))
    documentEvents.dispatchEvent(new Event('visibilitychange'))
    expect(instances.length).toBe(1)
    expect(Boolean(instances[0].closed)).toBe(false)
    scope.stop()
    expect(instances[0].closed).toBe(true)
  } finally {
    scope?.stop()
    global.EventSource = originalEventSource
    global.document = originalDocument
  }
})
