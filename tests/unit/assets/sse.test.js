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
