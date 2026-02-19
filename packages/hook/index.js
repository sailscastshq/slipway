/**
 * sails-hook-slipway
 *
 * Auto-instrumentation hook for Sails.js apps deployed on Slipway.
 * Captures HTTP request spans, unhandled exceptions, and Waterline
 * query metrics — ships them to the Slipway Lookout telemetry endpoint.
 *
 * Configuration is zero-config when deployed via Slipway: the
 * SLIPWAY_TELEMETRY_URL and SLIPWAY_TELEMETRY_TOKEN env vars are
 * automatically injected into the container at deploy time.
 *
 * Manual configuration (in config/slipway.js):
 *   module.exports.slipway = {
 *     lookout: {
 *       telemetryUrl: 'https://your-slipway.example.com/api/v1/telemetry/ingest',
 *       telemetryToken: 'stk_...',
 *       enabled: true,
 *       batchSize: 50,
 *       flushInterval: 10000,  // ms
 *       captureQueries: true,
 *       captureExceptions: true,
 *       slowQueryThreshold: 100  // ms
 *     }
 *   }
 */

const http = require('http')
const https = require('https')
const crypto = require('crypto')

module.exports = function defineSlipwayHook(sails) {
  // Telemetry buffers
  let spanBuffer = []
  let exceptionBuffer = []
  let metricBuffer = []
  let flushTimer = null

  // Config (populated in initialize)
  let config = {}

  return {
    defaults: {
      slipway: {
        lookout: {
          enabled: true,
          batchSize: 50,
          flushInterval: 10000,
          captureQueries: true,
          captureExceptions: true,
          captureQuestEvents: true,
          captureCache: true,
          slowQueryThreshold: 100
        }
      }
    },

    configure: function () {
      // Merge env vars with config (env vars take precedence)
      const envUrl = process.env.SLIPWAY_TELEMETRY_URL
      const envToken = process.env.SLIPWAY_TELEMETRY_TOKEN

      if (envUrl) sails.config.slipway.lookout.telemetryUrl = envUrl
      if (envToken) sails.config.slipway.lookout.telemetryToken = envToken
    },

    initialize: function (done) {
      config = sails.config.slipway.lookout

      // Skip if not configured
      if (!config.telemetryUrl || !config.telemetryToken) {
        sails.log.verbose('sails-hook-slipway: No telemetry endpoint configured, skipping.')
        return done()
      }

      if (!config.enabled) {
        sails.log.verbose('sails-hook-slipway: Disabled via config.')
        return done()
      }

      sails.log.info('sails-hook-slipway: Initializing telemetry instrumentation')

      // Start flush timer
      flushTimer = setInterval(flush, config.flushInterval)

      // Instrument unhandled exceptions (process-level handlers only)
      if (config.captureExceptions) {
        instrumentExceptions()
      }

      // Instrument Waterline queries
      if (config.captureQueries) {
        sails.after('hook:orm:loaded', () => {
          instrumentQueries()
        })
      }

      // Instrument Quest job lifecycle events
      if (config.captureQuestEvents) {
        instrumentQuest()
      }

      // Instrument sails-stash cache operations
      if (config.captureCache) {
        sails.after('hook:stash:loaded', () => {
          instrumentCache()
        })
      }

      return done()
    },

    // ─── HTTP Request & Exception Instrumentation ───────────────
    // Uses routes.before instead of sails.on('router:request') because
    // the router:request event doesn't fire reliably for all requests
    // (e.g. when Inertia middleware handles the response).
    routes: {
      before: {
        'all /*': function (req, res, next) {
          // Skip if telemetry is not configured or disabled
          if (!config.telemetryUrl || !config.telemetryToken || !config.enabled) {
            return next()
          }

          const startTime = Date.now()
          const traceId = crypto.randomBytes(16).toString('hex')
          const spanId = crypto.randomBytes(8).toString('hex')

          // Attach trace context to request
          req._slipwayTraceId = traceId
          req._slipwaySpanId = spanId

          // Patch res.serverError to capture handled exceptions
          if (config.captureExceptions) {
            const originalServerError = res.serverError
            if (typeof originalServerError === 'function') {
              res.serverError = function (data) {
                if (data instanceof Error) {
                  captureException(data, true, req)
                } else if (data && data.raw) {
                  captureException(data.raw instanceof Error ? data.raw : new Error(String(data.raw)), true, req)
                }
                return originalServerError.call(res, data)
              }
            }
          }

          // Hook into response finish to record the span
          const originalEnd = res.end
          res.end = function (...args) {
            // Restore immediately to prevent double-firing
            res.end = originalEnd

            const duration = Date.now() - startTime

            // Skip health check and static asset requests
            const url = req.originalUrl || req.url
            if (url !== '/health' && !url.startsWith('/__') && !url.match(/\.(js|css|png|jpg|svg|ico|map|woff|woff2)$/)) {
              spanBuffer.push({
                traceId,
                spanId,
                name: `${req.method} ${url}`,
                kind: 'server',
                method: req.method,
                url,
                statusCode: res.statusCode,
                duration,
                startedAt: startTime,
                attributes: {
                  'http.route': req.route ? req.route.path : url,
                  'http.user_agent': req.headers['user-agent'] || '',
                  'http.request_content_length': req.headers['content-length'] || 0,
                  'http.response_content_length': res.getHeader('content-length') || 0,
                  'http.client_ip': req.ip || req.headers['x-forwarded-for'] || '',
                  'http.referrer': req.headers.referer || '',
                  'http.accept': req.headers.accept || ''
                }
              })

              // Auto-flush if buffer is full
              if (spanBuffer.length >= config.batchSize) {
                flush()
              }
            }

            return originalEnd.apply(res, args)
          }

          next()
        }
      }
    },

    teardown: function (done) {
      if (flushTimer) {
        clearInterval(flushTimer)
      }
      // Final flush
      flush()
      return done()
    }
  }

  // ─── Exception Instrumentation (process-level) ─────────────────

  function instrumentExceptions() {
    // Capture unhandled exceptions
    process.on('uncaughtException', function (err) {
      captureException(err, false)
    })

    // Capture unhandled promise rejections
    process.on('unhandledRejection', function (reason) {
      const err = reason instanceof Error ? reason : new Error(String(reason))
      captureException(err, false)
    })
  }

  function captureException(err, handled, req) {
    const exception = {
      exceptionType: err.name || 'Error',
      message: err.message || 'Unknown error',
      stackTrace: err.stack || null,
      handled,
      method: req ? req.method : null,
      url: req ? (req.originalUrl || req.url) : null,
      traceId: req ? req._slipwayTraceId : null,
      occurredAt: Date.now()
    }

    exceptionBuffer.push(exception)

    // Flush immediately for exceptions (they're important)
    if (exceptionBuffer.length >= 10) {
      flush()
    }
  }

  // ─── Waterline Query Instrumentation ──────────────────────────

  function instrumentQueries() {
    const models = sails.models
    const methodsToInstrument = [
      'find', 'findOne', 'create', 'createEach',
      'update', 'updateOne', 'destroy', 'destroyOne',
      'count', 'sum', 'avg'
    ]

    for (const modelName of Object.keys(models)) {
      const model = models[modelName]
      if (!model || !model.globalId) continue

      for (const method of methodsToInstrument) {
        if (typeof model[method] !== 'function') continue

        const originalMethod = model[method]
        model[method] = function (...args) {
          const startTime = Date.now()
          const deferred = originalMethod.apply(model, args)

          // Waterline returns deferred objects — intercept .then()
          if (deferred && typeof deferred.then === 'function') {
            const originalThen = deferred.then
            deferred.then = function (resolve, reject) {
              return originalThen.call(deferred,
                function (result) {
                  const duration = Date.now() - startTime
                  recordQueryMetric(modelName, method, duration, args)
                  if (resolve) return resolve(result)
                  return result
                },
                function (err) {
                  const duration = Date.now() - startTime
                  recordQueryMetric(modelName, method, duration, args, true)
                  if (reject) return reject(err)
                  throw err
                }
              )
            }
          }

          return deferred
        }
      }
    }
  }

  function recordQueryMetric(modelName, method, duration, args, isError) {
    // Only record if above threshold
    if (duration < config.slowQueryThreshold && !isError) {
      return
    }

    const metric = {
      name: 'db.query',
      value: duration,
      unit: 'ms',
      attributes: {
        model: modelName,
        method,
        slow: duration >= config.slowQueryThreshold,
        error: Boolean(isError)
      },
      recordedAt: Date.now()
    }

    // Add a simplified query representation
    if (args[0] && typeof args[0] === 'object') {
      const criteria = args[0]
      const keys = Object.keys(criteria).slice(0, 5)
      if (keys.length > 0) {
        metric.attributes.query = `${modelName}.${method}({ ${keys.join(', ')} })`
      } else {
        metric.attributes.query = `${modelName}.${method}()`
      }
    } else {
      metric.attributes.query = `${modelName}.${method}()`
    }

    metricBuffer.push(metric)

    if (metricBuffer.length >= config.batchSize) {
      flush()
    }
  }

  // ─── Quest Job Lifecycle Instrumentation ─────────────────────

  function instrumentQuest() {
    sails.on('quest:job:start', function (data) {
      metricBuffer.push({
        name: 'quest.job.start',
        value: 0,
        unit: 'ms',
        attributes: {
          jobName: data.name,
          inputs: data.inputs || {}
        },
        recordedAt: data.timestamp || Date.now()
      })
    })

    sails.on('quest:job:complete', function (data) {
      metricBuffer.push({
        name: 'quest.job.complete',
        value: typeof data.duration === 'number' ? data.duration : 0,
        unit: 'ms',
        attributes: {
          jobName: data.name,
          inputs: data.inputs || {}
        },
        recordedAt: data.timestamp || Date.now()
      })
    })

    sails.on('quest:job:error', function (data) {
      metricBuffer.push({
        name: 'quest.job.error',
        value: typeof data.duration === 'number' ? data.duration : 0,
        unit: 'ms',
        attributes: {
          jobName: data.name,
          inputs: data.inputs || {},
          error: data.error ? (data.error.message || String(data.error)) : 'Unknown error'
        },
        recordedAt: data.timestamp || Date.now()
      })

      // Also capture as an exception for the exceptions tab
      exceptionBuffer.push({
        exceptionType: 'QuestJobError',
        message: `Job "${data.name}" failed: ${data.error ? (data.error.message || String(data.error)) : 'Unknown error'}`,
        stackTrace: data.error ? data.error.stack : null,
        handled: true,
        method: null,
        url: null,
        traceId: null,
        occurredAt: data.timestamp || Date.now()
      })

      // Send job failure notification
      if (sails.helpers.notification) {
        sails.helpers.notification.sendJobFailureNotification.with({
          jobName: data.name,
          errorMessage: data.error ? (data.error.message || String(data.error)) : 'Unknown error',
          duration: typeof data.duration === 'number' ? data.duration : undefined
        }).tolerate('error')
      }

      // Flush immediately on errors
      flush()
    })
  }

  // ─── Cache Instrumentation (sails-stash) ─────────────────────

  function instrumentCache() {
    if (!sails.cache) return

    // Wrap get(key, default?)
    const originalGet = sails.cache.get.bind(sails.cache)
    sails.cache.get = async function (key, ...rest) {
      const startTime = Date.now()
      const result = await originalGet(key, ...rest)
      const duration = Date.now() - startTime
      const name = result !== undefined ? 'cache.hit' : 'cache.miss'
      recordCacheMetric(name, key, duration)
      return result
    }

    // Wrap fetch(key, cb, ttl?)
    const originalFetch = sails.cache.fetch.bind(sails.cache)
    sails.cache.fetch = async function (key, cb, ...rest) {
      const startTime = Date.now()
      let wasMiss = false
      const wrappedCb = async function (...cbArgs) {
        wasMiss = true
        return cb(...cbArgs)
      }
      const result = await originalFetch(key, wrappedCb, ...rest)
      const duration = Date.now() - startTime
      const name = wasMiss ? 'cache.miss' : 'cache.hit'
      recordCacheMetric(name, key, duration)
      return result
    }

    // Wrap set(key, value, ttl?)
    const originalSet = sails.cache.set.bind(sails.cache)
    sails.cache.set = async function (key, ...rest) {
      const startTime = Date.now()
      const result = await originalSet(key, ...rest)
      const duration = Date.now() - startTime
      recordCacheMetric('cache.write', key, duration)
      return result
    }

    // Wrap delete(key)
    const originalDelete = sails.cache.delete.bind(sails.cache)
    sails.cache.delete = async function (key, ...rest) {
      const startTime = Date.now()
      const result = await originalDelete(key, ...rest)
      const duration = Date.now() - startTime
      recordCacheMetric('cache.delete', key, duration)
      return result
    }
  }

  function recordCacheMetric(name, key, duration) {
    metricBuffer.push({
      name,
      value: duration,
      unit: 'ms',
      attributes: { key: String(key) },
      recordedAt: Date.now()
    })

    if (metricBuffer.length >= config.batchSize) {
      flush()
    }
  }

  // ─── Flush Telemetry Data ─────────────────────────────────────

  function flush() {
    // Grab current buffers and reset
    const spans = spanBuffer.splice(0)
    const exceptions = exceptionBuffer.splice(0)
    const metrics = metricBuffer.splice(0)

    if (spans.length === 0 && exceptions.length === 0 && metrics.length === 0) {
      return
    }

    const payload = JSON.stringify({ spans, exceptions, metrics })

    try {
      const url = new URL(config.telemetryUrl)
      const transport = url.protocol === 'https:' ? https : http

      const req = transport.request({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'Authorization': `Bearer ${config.telemetryToken}`
        },
        timeout: 5000
      })

      req.on('error', function () {
        // Silently fail — telemetry should never break the app
      })

      req.on('timeout', function () {
        req.destroy()
      })

      req.write(payload)
      req.end()
    } catch {
      // Silently fail
    }
  }
}
