/**
 * SSE hook
 *
 * Eliminates SSE boilerplate across all streaming endpoints.
 *
 * Level 1 — res.sse():
 *   Returns an SseStream object that handles headers, safe writes,
 *   JSON serialization, heartbeats, cleanup, and the Sails-blocking Promise.
 *
 * Level 2 — sails.sse.publish/subscribe:
 *   Channel-based pub/sub for broadcasting events to multiple clients.
 */

module.exports = function defineSseHook(sails) {
  // Every res.sse() stream, including raw controller-managed streams.
  const activeStreams = new Set()
  // Level 2: channel → Set<SseStream>
  const channels = new Map()

  function closeAllStreams() {
    for (const stream of Array.from(activeStreams)) {
      stream.close()
    }
    activeStreams.clear()
    channels.clear()
  }

  return {
    initialize: async function () {
      sails.log.info('Initializing hook (`sse`)')

      // Expose Level 2 pub/sub on sails.sse
      sails.sse = {
        /**
         * Subscribe a request to a named channel.
         * Returns a Promise that keeps Sails alive until disconnect.
         *
         * @param {Request}  req
         * @param {Response} res
         * @param {string}   channel
         * @returns {Promise}
         */
        subscribe: function (req, res, channel) {
          const stream = res.sse()

          if (!channels.has(channel)) {
            channels.set(channel, new Set())
          }
          channels.get(channel).add(stream)

          stream.onClose(() => {
            const subs = channels.get(channel)
            if (subs) {
              subs.delete(stream)
              if (subs.size === 0) {
                channels.delete(channel)
              }
            }
          })

          return stream.wait()
        },

        /**
         * Broadcast data to all subscribers on a channel.
         *
         * @param {string}  channel
         * @param {*}       data  - Will be JSON-serialized
         * @param {string}  [event] - Optional SSE event name
         */
        publish: function (channel, data, event) {
          const subs = channels.get(channel)
          if (!subs) return
          for (const stream of subs) {
            stream.send(data, event)
          }
        }
      }

      sails.on('lower', closeAllStreams)
    },

    routes: {
      before: {
        '/*': {
          skipAssets: true,
          fn: function (req, res, next) {
            /**
             * Level 1: res.sse()
             *
             * Commits SSE headers and returns an SseStream controller object.
             * Call this once at the top of any SSE action.
             *
             * @returns {SseStream}
             */
            // Cache the stream so double-calls return the same instance
            let _sseStream = null

            res.sse = function () {
              // Idempotent — second call returns the existing stream
              if (_sseStream) return _sseStream

              // Guard: if headers were already sent (e.g. by middleware),
              // log a warning and return a no-op stream so the action doesn't crash
              if (res.headersSent) {
                sails.log.warn(
                  'res.sse() called but headers already sent — returning no-op stream'
                )
                _sseStream = noopStream()
                return _sseStream
              }

              // Commit headers immediately so Sails cannot override them
              res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache, no-transform',
                Connection: 'keep-alive',
                'X-Accel-Buffering': 'no',
                'Content-Encoding': 'identity'
              })

              let closed = false
              const cleanupFns = []
              let resolveWait = null
              let stream = null

              function runCleanup() {
                if (closed) return
                closed = true
                if (stream) {
                  activeStreams.delete(stream)
                }
                for (const fn of cleanupFns) {
                  try {
                    fn()
                  } catch (e) {
                    /* swallow */
                  }
                }
              }

              // Auto-cleanup on client disconnect
              req.on('close', runCleanup)

              // Handle response errors (e.g. client disconnect during gzip)
              res.on('error', runCleanup)

              stream = {
                /**
                 * Whether the stream has been closed.
                 */
                get closed() {
                  return closed
                },

                /**
                 * Send a JSON-encoded SSE frame.
                 * Returns false if the stream is already closed.
                 *
                 * @param {*}      data    - Will be JSON.stringify'd
                 * @param {string} [event] - Optional SSE event name
                 * @returns {boolean}
                 */
                send: function (data, event) {
                  if (closed || res.writableEnded || res.destroyed) return false
                  try {
                    let frame = ''
                    if (event) {
                      frame += `event: ${event}\n`
                    }
                    frame += `data: ${JSON.stringify(data)}\n\n`
                    res.write(frame)
                    if (res.flush) res.flush()
                    return true
                  } catch (err) {
                    runCleanup()
                    return false
                  }
                },

                /**
                 * Send a comment-only keepalive.
                 */
                heartbeat: function () {
                  if (closed || res.writableEnded || res.destroyed) return
                  try {
                    res.write(': heartbeat\n\n')
                  } catch (e) {
                    runCleanup()
                  }
                },

                /**
                 * End the stream. Fires cleanup callbacks and resolves wait().
                 */
                close: function () {
                  runCleanup()
                  try {
                    res.end()
                  } catch (e) {
                    /* ignore */
                  }
                  if (resolveWait) resolveWait()
                },

                /**
                 * Register a cleanup callback. Runs once when the stream closes
                 * (client disconnect, explicit close, or error).
                 *
                 * @param {Function} fn
                 */
                onClose: function (fn) {
                  if (closed) {
                    // Already closed — fire immediately
                    try {
                      fn()
                    } catch (e) {
                      /* swallow */
                    }
                    return
                  }
                  cleanupFns.push(fn)
                },

                /**
                 * Returns a Promise that keeps the Sails action alive.
                 * Resolves when the stream closes (client disconnect or explicit close).
                 *
                 * @returns {Promise<void>}
                 */
                wait: function () {
                  return new Promise((resolve) => {
                    resolveWait = resolve
                    // If already closed, resolve immediately
                    if (closed) resolve()
                    // Otherwise resolve on cleanup
                    stream.onClose(() => resolve())
                  })
                }
              }

              activeStreams.add(stream)
              const heartbeatInterval = setInterval(() => {
                stream.heartbeat()
              }, 15 * 1000)
              heartbeatInterval.unref?.()
              stream.onClose(() => clearInterval(heartbeatInterval))
              _sseStream = stream
              return stream
            }

            return next()
          }
        }
      }
    },

    teardown: function (done) {
      sails.removeListener('lower', closeAllStreams)
      closeAllStreams()
      done()
    }
  }

  /**
   * Returns a stream where every method is safe but does nothing.
   * Used when res.sse() is called after headers are already sent,
   * so the action doesn't crash — it just silently drops events.
   */
  function noopStream() {
    return {
      get closed() {
        return true
      },
      send() {
        return false
      },
      heartbeat() {},
      close() {},
      onClose(fn) {
        try {
          fn()
        } catch (e) {
          /* swallow */
        }
      },
      wait() {
        return Promise.resolve()
      }
    }
  }
}
