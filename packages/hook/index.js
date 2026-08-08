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
const { createReleaseFlags } = require('./lib/release-flags')
const { injectBearingWidget } = require('./lib/bearing-widget')
const buildFlagsEnabledHelper = require('./lib/helpers/flags/enabled')
const {
  ACCESS_DENIED_MESSAGE,
  renderBridgeAccessDenied
} = require('./lib/render-bridge-access-denied')

module.exports = function defineSlipwayHook(sails) {
  // Telemetry buffers
  let spanBuffer = []
  let exceptionBuffer = []
  let metricBuffer = []
  let flushTimer = null

  // Config (populated in initialize)
  let config = {}
  let bridgeConfig = {}
  let bearingConfig = {}
  let flagsConfig = {}
  let releaseFlags = null

  return {
    defaults: {
      slipway: {
        identity: {},
        bridge: {
          enabled: false,
          loginPath: '/login',
          identity: {
            model: 'user',
            sessionKey: 'userId',
            emailAttribute: 'email',
            nameAttribute: 'fullName',
            emailStatusAttribute: 'emailStatus',
            emailVerifiedAttribute: 'emailVerified',
            verifiedEmailStatuses: ['verified', 'confirmed']
          }
        },
        bearing: {
          enabled: false
        },
        flags: {
          enabled: true,
          refreshInterval: 15000,
          requestTimeout: 3000
        },
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

      if (process.env.SLIPWAY_FLAGS_URL) {
        sails.config.slipway.flags.url = process.env.SLIPWAY_FLAGS_URL
      }
      if (process.env.SLIPWAY_FLAGS_TOKEN) {
        sails.config.slipway.flags.token = process.env.SLIPWAY_FLAGS_TOKEN
      }
      if (process.env.SLIPWAY_FLAGS_APP_ID) {
        sails.config.slipway.flags.appId = process.env.SLIPWAY_FLAGS_APP_ID
      }

      if (process.env.SLIPWAY_BRIDGE_ENABLED === 'true') {
        sails.config.slipway.bridge.enabled = true
      }
      if (process.env.SLIPWAY_BRIDGE_EXCHANGE_URL) {
        sails.config.slipway.bridge.exchangeUrl =
          process.env.SLIPWAY_BRIDGE_EXCHANGE_URL
      }
      if (process.env.SLIPWAY_BRIDGE_APP_ID) {
        sails.config.slipway.bridge.appId = process.env.SLIPWAY_BRIDGE_APP_ID
      }
      if (process.env.SLIPWAY_BRIDGE_SECRET) {
        sails.config.slipway.bridge.secret = process.env.SLIPWAY_BRIDGE_SECRET
      }
      if (process.env.SLIPWAY_BRIDGE_ROUTE_PATH) {
        sails.config.slipway.bridge.routePath =
          process.env.SLIPWAY_BRIDGE_ROUTE_PATH
      }

      if (process.env.SLIPWAY_BEARING_ENABLED === 'true') {
        sails.config.slipway.bearing.enabled = true
      }
      if (process.env.SLIPWAY_BEARING_EXCHANGE_URL) {
        sails.config.slipway.bearing.exchangeUrl =
          process.env.SLIPWAY_BEARING_EXCHANGE_URL
      }
      if (process.env.SLIPWAY_BEARING_APP_ID) {
        sails.config.slipway.bearing.appId = process.env.SLIPWAY_BEARING_APP_ID
      }
      if (process.env.SLIPWAY_BEARING_SECRET) {
        sails.config.slipway.bearing.secret = process.env.SLIPWAY_BEARING_SECRET
      }
      if (process.env.SLIPWAY_BEARING_ROUTE_PATH) {
        sails.config.slipway.bearing.routePath =
          process.env.SLIPWAY_BEARING_ROUTE_PATH
      }
    },

    initialize: function (done) {
      config = sails.config.slipway.lookout || {}
      bridgeConfig = sails.config.slipway.bridge || {}
      bearingConfig = sails.config.slipway.bearing || {}
      flagsConfig = sails.config.slipway.flags || {
        enabled: true,
        refreshInterval: 15000,
        requestTimeout: 3000
      }
      return initializeReleaseFlags((error) => {
        if (error) return done(error)
        return initializeTelemetry(done)
      })
    },

    // ─── HTTP Request & Exception Instrumentation ───────────────
    // Uses routes.before instead of sails.on('router:request') because
    // the router:request event doesn't fire reliably for all requests
    // (e.g. when Inertia middleware handles the response).
    routes: {
      before: {
        'all /*': function (req, res, next) {
          const telemetryEnabled = Boolean(
            config.telemetryUrl && config.telemetryToken && config.enabled
          )
          const bearingCapability = releaseFlags?.getCapability('bearing')
          const bearingWidgetEnabled = Boolean(
            bearingConfig.enabled &&
              bearingCapability?.enabled &&
              bearingCapability?.widgetEnabled
          )

          if (!telemetryEnabled && !bearingWidgetEnabled) {
            return next()
          }

          const startTime = Date.now()
          const traceId = crypto.randomBytes(16).toString('hex')
          const spanId = crypto.randomBytes(8).toString('hex')

          // Attach trace context to request
          req._slipwayTraceId = traceId
          req._slipwaySpanId = spanId

          // Patch res.serverError to capture handled exceptions
          if (telemetryEnabled && config.captureExceptions) {
            const originalServerError = res.serverError
            if (typeof originalServerError === 'function') {
              res.serverError = function (data) {
                if (data instanceof Error) {
                  captureException(data, true, req)
                } else if (data && data.raw) {
                  captureException(
                    data.raw instanceof Error
                      ? data.raw
                      : new Error(String(data.raw)),
                    true,
                    req
                  )
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

            if (bearingWidgetEnabled) {
              args = injectBearingWidget(req, res, args, bearingCapability)
            }

            const duration = Date.now() - startTime

            // Skip health check and static asset requests
            const url = req.originalUrl || req.url
            if (
              telemetryEnabled &&
              url !== '/health' &&
              !url.startsWith('/__') &&
              !url.match(/\.(js|css|png|jpg|svg|ico|map|woff|woff2)$/)
            ) {
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
                  'http.request_content_length':
                    req.headers['content-length'] || 0,
                  'http.response_content_length':
                    res.getHeader('content-length') || 0,
                  'http.client_ip':
                    req.ip || req.headers['x-forwarded-for'] || '',
                  'http.referrer': req.headers.referer || '',
                  'http.accept': req.headers.accept || '',
                  ...(req._slipwayFlagEvaluations
                    ? {
                        'feature.flags': req._slipwayFlagEvaluations,
                        ...(flagsConfig.appId
                          ? { 'feature.app_id': String(flagsConfig.appId) }
                          : {})
                      }
                    : {})
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
      },
      after: {
        'GET /bridge': createBridgeRoute(false),
        'GET /_slipway/bridge': createBridgeRoute(true),
        'GET /_slipway/bearing/identity': createBearingIdentityRoute()
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

  function createBridgeRoute(hostOrigin) {
    return async function openBridge(req, res) {
      if (!bridgeConfig.enabled) {
        return res.notFound()
      }

      if (
        !bridgeConfig.exchangeUrl ||
        !bridgeConfig.appId ||
        !bridgeConfig.secret
      ) {
        sails.log.warn(
          'sails-hook-slipway: Bridge is enabled but its Slipway exchange credentials are unavailable.'
        )
        return res.serverError(
          'Bridge is not configured for this deployment. Redeploy the app from Slipway.'
        )
      }

      let identity
      try {
        identity = await resolveBridgeIdentity(req)
      } catch (error) {
        sails.log.warn(
          `sails-hook-slipway: Could not resolve the Bridge user: ${
            error.message || error
          }`
        )
        return denyBridgeAccess(req, res, hostOrigin)
      }

      if (!identity) {
        let returnUrl = hostOrigin
          ? withBridgeRoutePrefix('/_slipway/bridge')
          : safeLocalPath(req.originalUrl, '/bridge')
        if (hostOrigin && typeof req.query?.invite === 'string') {
          returnUrl += `?invite=${encodeURIComponent(req.query.invite)}`
        }
        const loginUrl = await resolveLoginUrl({
          req,
          featureConfig: bridgeConfig,
          featureName: 'Bridge',
          returnUrl,
          prefixPath: hostOrigin ? withBridgeRoutePrefix : (path) => path
        })
        return res.redirect(loginUrl)
      }

      if (!identity.emailVerified) {
        return denyBridgeAccess(req, res, hostOrigin)
      }

      try {
        const response = await requestJson({
          url: bridgeConfig.exchangeUrl,
          token: bridgeConfig.secret,
          body: {
            appId: String(bridgeConfig.appId),
            hostUser: identity,
            inviteToken:
              typeof req.query?.invite === 'string'
                ? req.query.invite
                : undefined,
            hostOrigin
          }
        })

        if (!response.launchUrl) {
          throw new Error('Slipway did not return a Bridge launch URL.')
        }

        return res.redirect(response.launchUrl)
      } catch (error) {
        if (error.statusCode === 403) {
          return denyBridgeAccess(req, res, hostOrigin)
        }

        sails.log.warn(
          `sails-hook-slipway: Bridge exchange failed: ${
            error.message || error
          }`
        )
        return res.serverError(
          'Bridge could not contact Slipway. Try again in a moment.'
        )
      }
    }
  }

  function createBearingIdentityRoute() {
    return async function proveBearingIdentity(req, res) {
      if (!bearingConfig.enabled) return res.notFound()

      if (
        !bearingConfig.exchangeUrl ||
        !bearingConfig.appId ||
        !bearingConfig.secret
      ) {
        sails.log.warn(
          'sails-hook-slipway: Bearing is enabled but its Slipway exchange credentials are unavailable.'
        )
        return res.serverError(
          'Bearing is not configured for this deployment. Redeploy the app from Slipway.'
        )
      }

      let identity
      try {
        identity = await resolveBridgeIdentity(req, bearingConfig, 'Bearing')
      } catch (error) {
        sails.log.warn(
          `sails-hook-slipway: Could not resolve the Bearing participant: ${
            error.message || error
          }`
        )
        return res.forbidden('Bearing could not verify this account.')
      }

      if (!identity) {
        const returnUrl = withBearingRoutePrefix('/_slipway/bearing/identity')
        const loginUrl = await resolveLoginUrl({
          req,
          featureConfig: bearingConfig,
          featureName: 'Bearing',
          returnUrl,
          prefixPath: withBearingRoutePrefix
        })
        return res.redirect(loginUrl)
      }

      if (!identity.emailVerified) {
        return res.forbidden('Bearing requires a verified account.')
      }

      try {
        const response = await requestJson({
          url: bearingConfig.exchangeUrl,
          token: bearingConfig.secret,
          body: {
            appId: String(bearingConfig.appId),
            hostUser: identity
          }
        })
        if (!response.launchUrl) {
          throw new Error('Slipway did not return a Bearing launch URL.')
        }
        return res.redirect(response.launchUrl)
      } catch (error) {
        sails.log.warn(
          `sails-hook-slipway: Bearing exchange failed: ${
            error.message || error
          }`
        )
        return res.serverError(
          'Bearing could not contact Slipway. Try again in a moment.'
        )
      }
    }
  }

  function withBridgeRoutePrefix(path) {
    const routePath = String(bridgeConfig.routePath || '').replace(
      /^\/+|\/+$/g,
      ''
    )
    const normalizedPath = safeLocalPath(path, '/')
    if (!routePath) return normalizedPath
    const prefix = `/${routePath}`
    return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`)
      ? normalizedPath
      : `${prefix}${normalizedPath}`
  }

  function withBearingRoutePrefix(path) {
    const routePath = String(bearingConfig.routePath || '').replace(
      /^\/+|\/+$/g,
      ''
    )
    const normalizedPath = safeLocalPath(path, '/')
    if (!routePath) return normalizedPath
    const prefix = `/${routePath}`
    return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`)
      ? normalizedPath
      : `${prefix}${normalizedPath}`
  }

  function denyBridgeAccess(req, res, hostOrigin) {
    res.statusCode = 403

    if (req.wantsJSON && !acceptsHtml(req)) {
      return res.json({
        error: 'Forbidden',
        code: 'bridge_access_denied',
        message: ACCESS_DENIED_MESSAGE
      })
    }

    const homePath = withBridgeRoutePrefix('/')
    const currentPath = safeLocalPath(
      req.originalUrl,
      hostOrigin
        ? withBridgeRoutePrefix('/_slipway/bridge')
        : withBridgeRoutePrefix('/bridge')
    )
    const retryPath = hostOrigin
      ? withBridgeRoutePrefix(currentPath)
      : currentPath
    return res
      .type('html')
      .send(renderBridgeAccessDenied({ retryPath, homePath }))
  }

  function acceptsHtml(req) {
    const accept = req.get?.('accept') || req.headers?.accept || ''
    return String(accept).includes('text/html')
  }

  function initializeTelemetry(done) {
    if (!config.telemetryUrl || !config.telemetryToken) {
      sails.log.verbose(
        'sails-hook-slipway: No telemetry endpoint configured, skipping.'
      )
      return done()
    }

    if (!config.enabled) {
      sails.log.verbose('sails-hook-slipway: Disabled via config.')
      return done()
    }

    sails.log.info('sails-hook-slipway: Initializing telemetry instrumentation')
    flushTimer = setInterval(flush, config.flushInterval)

    if (config.captureExceptions) {
      instrumentExceptions()
    }

    if (config.captureQueries) {
      sails.after('hook:orm:loaded', () => {
        instrumentQueries()
      })
    }

    if (config.captureQuestEvents) {
      instrumentQuest()
    }

    if (config.captureCache) {
      sails.after('hook:stash:loaded', () => {
        instrumentCache()
      })
    }

    return done()
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
      url: req ? req.originalUrl || req.url : null,
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
      'find',
      'findOne',
      'create',
      'createEach',
      'update',
      'updateOne',
      'destroy',
      'destroyOne',
      'count',
      'sum',
      'avg'
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
              return originalThen.call(
                deferred,
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
        metric.attributes.query = `${modelName}.${method}({ ${keys.join(
          ', '
        )} })`
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
          error: data.error
            ? data.error.message || String(data.error)
            : 'Unknown error'
        },
        recordedAt: data.timestamp || Date.now()
      })

      // Also capture as an exception for the exceptions tab
      exceptionBuffer.push({
        exceptionType: 'QuestJobError',
        message: `Job "${data.name}" failed: ${
          data.error
            ? data.error.message || String(data.error)
            : 'Unknown error'
        }`,
        stackTrace: data.error ? data.error.stack : null,
        handled: true,
        method: null,
        url: null,
        traceId: null,
        occurredAt: data.timestamp || Date.now()
      })

      // Send job failure notification
      if (sails.helpers.notification) {
        sails.helpers.notification.sendJobFailureNotification
          .with({
            jobName: data.name,
            errorMessage: data.error
              ? data.error.message || String(data.error)
              : 'Unknown error',
            duration:
              typeof data.duration === 'number' ? data.duration : undefined
          })
          .tolerate('error')
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
          Authorization: `Bearer ${config.telemetryToken}`
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

  async function resolveBridgeIdentity(
    req,
    featureConfig = bridgeConfig,
    featureName = 'Bridge'
  ) {
    const identityConfig = {
      ...(bridgeConfig.identity || {}),
      ...(sails.config.slipway.identity || {}),
      ...(featureConfig.identity || {})
    }
    if (identityConfig.helper) {
      const helper = resolveHelper(identityConfig.helper)
      if (!helper) {
        throw new Error(
          `Configured ${featureName} identity helper "${identityConfig.helper}" is unavailable.`
        )
      }
      const resolved = await helper.with({ req })
      return normalizeBridgeIdentity(resolved, featureName)
    }

    const sessionKey = identityConfig.sessionKey || 'userId'
    const userId = req.session && req.session[sessionKey]
    if (!userId) return null

    const modelIdentity = String(identityConfig.model || 'user').toLowerCase()
    const model = sails.models[modelIdentity]
    if (!model) {
      throw new Error(
        `${featureName} identity model "${modelIdentity}" is unavailable.`
      )
    }

    const user = await model.findOne({ id: userId })
    if (!user) return null

    const emailAttribute = identityConfig.emailAttribute || 'email'
    const nameAttribute = identityConfig.nameAttribute || 'fullName'
    const statusAttribute = identityConfig.emailStatusAttribute || 'emailStatus'
    const verifiedAttribute =
      identityConfig.emailVerifiedAttribute || 'emailVerified'
    const hasStatusAttribute = Boolean(model.attributes?.[statusAttribute])
    const hasVerifiedAttribute = Boolean(model.attributes?.[verifiedAttribute])
    const acceptedStatuses = identityConfig.verifiedEmailStatuses || [
      'verified',
      'confirmed'
    ]
    if (!hasStatusAttribute && !hasVerifiedAttribute) {
      throw new Error(
        `${featureName} cannot prove email verification from "${modelIdentity}". Configure slipway.${featureName.toLowerCase()}.identity.helper.`
      )
    }

    return normalizeBridgeIdentity(
      {
        id: user.id,
        email: user[emailAttribute],
        fullName: user[nameAttribute],
        emailVerified:
          (hasStatusAttribute &&
            acceptedStatuses.includes(user[statusAttribute])) ||
          (hasVerifiedAttribute && user[verifiedAttribute] === true)
      },
      featureName
    )
  }

  function resolveHelper(identity) {
    return String(identity)
      .split('.')
      .reduce((cursor, segment) => cursor && cursor[segment], sails.helpers)
  }

  function normalizeBridgeIdentity(identity, featureName = 'Bridge') {
    if (!identity || identity.id === undefined || identity.id === null) {
      return null
    }

    const email = String(identity.email || '')
      .trim()
      .toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error(
        `The ${featureName} identity helper returned an invalid email.`
      )
    }

    return {
      id: String(identity.id),
      email,
      fullName:
        String(identity.fullName || '')
          .trim()
          .slice(0, 200) || null,
      emailVerified: identity.emailVerified === true
    }
  }

  function safeLocalPath(value, fallback) {
    const path = String(value || fallback)
    return path.startsWith('/') && !path.startsWith('//') ? path : fallback
  }

  async function resolveLoginUrl({
    req,
    featureConfig,
    featureName,
    returnUrl,
    prefixPath
  }) {
    const identityConfig = {
      ...(bridgeConfig.identity || {}),
      ...(sails.config.slipway.identity || {}),
      ...(featureConfig.identity || {})
    }
    const helperIdentity =
      featureConfig.loginHelper || identityConfig.loginHelper
    if (helperIdentity) {
      const helper = resolveHelper(helperIdentity)
      if (!helper) {
        throw new Error(
          `Configured ${featureName} login helper "${helperIdentity}" is unavailable.`
        )
      }
      const value = await helper.with({ req, returnUrl, feature: featureName })
      return safeLocalPath(value, returnUrl)
    }

    const loginPath = safeLocalPath(
      featureConfig.loginPath ||
        identityConfig.loginPath ||
        bridgeConfig.loginPath,
      '/login'
    )
    return `${prefixPath(loginPath)}?redirect=${encodeURIComponent(returnUrl)}`
  }

  function initializeReleaseFlags(done) {
    releaseFlags = createReleaseFlags({
      url: flagsConfig.url,
      token: flagsConfig.token,
      refreshInterval: flagsConfig.refreshInterval,
      requestTimeout: flagsConfig.requestTimeout
    })

    if (!sails.hooks.helpers) {
      return done(
        new Error(
          'Cannot load sails-hook-slipway without enabling the "helpers" hook!'
        )
      )
    }

    sails.after('hook:helpers:loaded', () => {
      try {
        if (sails.helpers.flags?.enabled) {
          sails.log.warn(
            'sails-hook-slipway: Keeping the app-owned `flags.enabled` helper.'
          )
          return done()
        }

        sails.hooks.helpers.furnishHelper(
          'flags.enabled',
          buildFlagsEnabledHelper({ evaluate: evaluateReleaseFlag })
        )
      } catch (error) {
        return done(error)
      }

      if (
        (flagsConfig.enabled || bearingConfig.enabled) &&
        flagsConfig.url &&
        flagsConfig.token
      ) {
        releaseFlags.refresh().catch(() => {})
      }
      return done()
    })
  }

  async function evaluateReleaseFlag(inputs) {
    const defaultValue = inputs.defaultValue === true
    if (!flagsConfig.enabled || !flagsConfig.url || !flagsConfig.token) {
      recordFlagEvaluation(inputs.req, inputs.key, defaultValue, 'default')
      return defaultValue
    }

    const evaluation = await releaseFlags.evaluate({
      key: inputs.key,
      context: requestFlagContext(inputs.req, inputs.context),
      defaultValue
    })
    recordFlagEvaluation(
      inputs.req,
      inputs.key,
      evaluation.value,
      evaluation.reason,
      evaluation.flagVersion
    )
    return evaluation.value
  }

  function requestFlagContext(req, supplied = {}) {
    supplied = supplied || {}
    const me = req?.me || {}
    const session = req?.session || {}
    return {
      user: supplied.user ?? me.id ?? session.userId,
      account: supplied.account ?? me.account ?? session.accountId,
      tenant: supplied.tenant ?? me.tenant ?? session.tenantId,
      team: supplied.team ?? me.team ?? session.teamId,
      session: supplied.session ?? req?.sessionID ?? session.id
    }
  }

  function recordFlagEvaluation(req, key, value, reason, version) {
    if (!req || !key) return
    req._slipwayFlagEvaluations = req._slipwayFlagEvaluations || {}
    req._slipwayFlagEvaluations[String(key)] = {
      value: value === true,
      reason,
      version: version || null
    }
  }

  function requestJson({ url, token, body }) {
    return new Promise((resolve, reject) => {
      let endpoint
      try {
        endpoint = new URL(url)
      } catch {
        return reject(new Error('The Bridge exchange URL is invalid.'))
      }

      const payload = JSON.stringify(body)
      const transport = endpoint.protocol === 'https:' ? https : http
      const request = transport.request(
        {
          hostname: endpoint.hostname,
          port: endpoint.port,
          path: `${endpoint.pathname}${endpoint.search}`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
            Authorization: `Bearer ${token}`
          },
          timeout: 5000
        },
        (response) => {
          let responseBody = ''
          response.on('data', (chunk) => {
            responseBody += chunk
            if (responseBody.length > 64 * 1024) {
              response.destroy(
                new Error('The Bridge exchange response was too large.')
              )
            }
          })
          response.on('end', () => {
            let parsed = {}
            try {
              parsed = responseBody ? JSON.parse(responseBody) : {}
            } catch {
              /* handled by the status-aware error below */
            }

            if (response.statusCode < 200 || response.statusCode >= 300) {
              const error = new Error(
                parsed.message ||
                  parsed.error ||
                  `Bridge exchange returned HTTP ${response.statusCode}.`
              )
              error.statusCode = response.statusCode
              return reject(error)
            }
            return resolve(parsed)
          })
        }
      )

      request.on('error', reject)
      request.on('timeout', () => {
        request.destroy(new Error('Bridge exchange timed out.'))
      })
      request.write(payload)
      request.end()
    })
  }
}
