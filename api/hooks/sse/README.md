# SSE Hook

Eliminates SSE boilerplate across all streaming endpoints with two levels of support.

## Level 1: `res.sse()`

Call `res.sse()` in any Sails action to get an `SseStream` object. It commits SSE headers immediately and gives you a clean API for the stream lifecycle.

```js
fn: async function () {
  const stream = this.res.sse()

  stream.send({ hello: 'world' })          // JSON-encoded SSE frame
  stream.send({ type: 'alert' }, 'alert')  // with event name
  stream.heartbeat()                        // comment-only keepalive

  stream.onClose(() => {
    // runs once on client disconnect, res error, or explicit close
    clearInterval(myInterval)
  })

  return stream.wait()  // keeps Sails action alive until stream closes
}
```

### SseStream API

| Method                      | Description                                                         |
| --------------------------- | ------------------------------------------------------------------- |
| `stream.send(data, event?)` | JSON-encode + write SSE frame. Returns `false` if stream is closed. |
| `stream.heartbeat()`        | Write a comment-only keepalive (`: heartbeat`).                     |
| `stream.close()`            | End the stream, fire cleanup callbacks, resolve `wait()`.           |
| `stream.onClose(fn)`        | Register a cleanup callback. Idempotent, runs once.                 |
| `stream.wait()`             | Returns a Promise that resolves when the stream closes.             |
| `stream.closed`             | Boolean getter — `true` after close.                                |

### Safe writes

`stream.send()` checks `res.writableEnded` and `res.destroyed` before writing, and catches write errors. No need for manual `safeWrite` wrappers.

## Level 2: `sails.sse.publish/subscribe`

Channel-based pub/sub for broadcasting events to multiple SSE clients.

```js
// In a controller — subscribe a client to a channel
fn: async function () {
  return sails.sse.subscribe(this.req, this.res, `deploy:${id}`)
}

// Anywhere else — broadcast to all subscribers
sails.sse.publish(`deploy:${id}`, { status: 'building' })
sails.sse.publish(`deploy:${id}`, { built: true }, 'build-complete')  // with event name
```

- In-memory `Map<string, Set<SseStream>>` — auto-cleans empty channels
- Auto-unsubscribes on client disconnect
- `subscribe()` returns the `stream.wait()` Promise (keeps the action alive)

## Headers

All SSE streams use these headers:

```
Content-Type: text/event-stream
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
Content-Encoding: identity
```

`X-Accel-Buffering: no` disables nginx/Caddy proxy buffering. `Content-Encoding: identity` prevents compression middleware from buffering the stream.

## Graceful degradation

The hook is designed to degrade safely at every layer:

### Server-side (hook level)

| Scenario                                  | Behavior                                                 |
| ----------------------------------------- | -------------------------------------------------------- |
| `res.sse()` called twice                  | Returns the same stream (idempotent)                     |
| Headers already sent by middleware        | Returns a silent no-op stream + logs a warning           |
| `stream.send()` after client disconnects  | Returns `false`, no crash                                |
| `stream.onClose()` registered after close | Callback fires immediately                               |
| Sails shutdown while streams are open     | `teardown` closes all active streams and clears channels |

### Client-side (browser level)

SSE endpoints are **progressive enhancements** — pages load fully via Inertia (regular HTTP) before attempting to connect an `EventSource`. If SSE is unavailable:

- **Page still renders** — All app/service info (status, env vars, controls) works without SSE
- **Logs section shows error state** — `logsConnected` goes `false`, UI indicates the stream is down
- **Auto-reconnect** — Service logs retry after 3 seconds; `EventSource` itself retries by default
- **No data loss** — Logs are also persisted to the database by the Lookout hook every 5 minutes

### Infrastructure level

The SSE headers handle common proxy pitfalls:

- `X-Accel-Buffering: no` — Tells nginx/Caddy not to buffer the response
- `Content-Encoding: identity` — Prevents compression middleware from holding chunks
- `Connection: keep-alive` — Keeps the TCP connection open through load balancers
- `Cache-Control: no-cache, no-transform` — Prevents CDNs from caching or transforming the stream
