const http = require('node:http')
const https = require('node:https')
const fs = require('node:fs')
const path = require('node:path')
const resolveIdentity = require('./wake-identity')
const contract = require('./wake-contract')
const visitor = require('./wake-visitor')
const {
  allowsSameOriginScript,
  normalizeRoutePrefix
} = require('./bearing-widget')
const client = fs.readFileSync(path.join(__dirname, 'wake-client.js'), 'utf8')

module.exports = function createWakeRuntime(sails, config, hookVersion) {
  let stopped = false,
    timer,
    flushTimer,
    leaseUntil = 0,
    activeRegistration = false,
    activeFlush = false
  let lastIdentityWarning = 0,
    status = 'disabled',
    queue = [],
    policy = contract.settings()
  let incoming = 0,
    windowStart = 0,
    requests = 0
  let identityWaiting = 0,
    policyEpoch = 0
  const transports = new Set()
  const stats = { received: 0, dropped: 0, rejected: 0, delivered: 0 }
  const prefix = normalizeRoutePrefix(config.routePath)
  config = { ...config, routePath: prefix || '/' }
  const ready = () =>
    !stopped && Date.now() < leaseUntil && status === 'collecting'
  const canInject = () =>
    config.enabled === true &&
    !stopped &&
    !['disabled', 'revoked', 'invalid_configuration'].includes(status)
  function reset(next = 'unavailable') {
    policyEpoch++
    stats.dropped += queue.length
    queue = []
    leaseUntil = 0
    status = next
  }
  function identity(req) {
    return resolveIdentity(sails, req, () => {
      if (Date.now() - lastIdentityWarning < 60000) return
      lastIdentityWarning = Date.now()
      sails.log?.warn(
        'Wake identity is unavailable; permitted activity remains anonymous.'
      )
    })
  }
  async function send(suffix, payload) {
    const url = new URL(config.ingestUrl)
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      !url.pathname.endsWith('/ingest')
    )
      throw new Error('configuration')
    url.pathname = url.pathname.replace(/\/ingest$/, '/' + suffix)
    url.search = ''
    url.hash = ''
    const body = JSON.stringify({
      appId: config.appId,
      deploymentId: config.deploymentId,
      ...payload
    })
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (error, value) => {
        if (settled) return
        settled = true
        error ? reject(error) : resolve(value)
      }
      const request = (url.protocol === 'https:' ? https : http).request(
        url,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
            authorization: `Bearer ${config.secret}`
          }
        },
        (response) => {
          let result = ''
          response.setEncoding('utf8')
          response.on('data', (chunk) => {
            result += chunk
            if (Buffer.byteLength(result) > 4096)
              request.destroy(new Error('response size'))
          })
          response.on('error', (error) => finish(error))
          response.on('end', () => {
            try {
              finish(null, {
                status: response.statusCode,
                body: JSON.parse(result)
              })
            } catch {
              finish(null, { status: response.statusCode, body: null })
            }
          })
        }
      )
      transports.add(request)
      const deadline = setTimeout(
        () => request.destroy(new Error('deadline')),
        3000
      )
      deadline.unref?.()
      request.on('error', (error) => finish(error))
      request.on('close', () => {
        clearTimeout(deadline)
        transports.delete(request)
        finish(new Error('closed'))
      })
      request.end(body)
    })
  }
  async function register() {
    if (stopped || activeRegistration) return
    activeRegistration = true
    if (!ready()) status = 'connecting'
    try {
      const response = await send('register', { protocol: 2, hookVersion })
      if (stopped) return
      if (response.status === 401) {
        reset('revoked')
        clearInterval(timer)
        return
      }
      if (
        response.status !== 200 ||
        response.body?.protocol !== 2 ||
        response.body.collectionReady !== true ||
        response.body.leaseMs !== 120000
      ) {
        reset()
        return
      }
      const next = contract.settings(response.body.settings)
      if (!next.allowedOrigins.length) {
        reset('invalid_configuration')
        return
      }
      if (JSON.stringify(next) !== JSON.stringify(policy)) {
        policyEpoch++
        stats.dropped += queue.length
        queue = []
      }
      policy = next
      leaseUntil = Date.now() + 120000
      status = 'collecting'
    } catch {
      reset()
    } finally {
      activeRegistration = false
    }
  }
  async function flush() {
    if (!ready()) {
      if (queue.length) reset()
      return
    }
    if (activeFlush || !queue.length) return
    activeFlush = true
    const batch = queue.splice(0, 100)
    try {
      const response = await send('ingest', { events: batch })
      if (response.status === 401) reset('revoked')
      if (response.status === 200 && Number.isInteger(response.body?.accepted))
        stats.delivered += response.body.accepted
      else stats.dropped += batch.length
    } catch {
      stats.dropped += batch.length
    } finally {
      activeFlush = false
    }
  }
  function origin(req) {
    const raw = String(req.headers.origin || '')
    if (
      !policy.allowedOrigins.includes(raw) ||
      req.headers['sec-fetch-site'] === 'cross-site'
    )
      return null
    return raw
  }
  function blocked(req) {
    let local = false
    try {
      const hostname = new URL('http://' + req.headers.host).hostname
      local =
        hostname === 'localhost' ||
        hostname.startsWith('127.') ||
        hostname === '[::1]'
    } catch {
      local = true
    }
    return (
      (!config.allowTestTraffic && local) ||
      (policy.respectPrivacySignals &&
        (req.headers['sec-gpc'] === '1' || req.headers.dnt === '1')) ||
      Boolean(req._slipwaySupportSession || req.slipway?.supportSession) ||
      (!config.allowTestTraffic &&
        /bot|crawler|spider|headless/i.test(
          String(req.headers['user-agent'] || '')
        ))
    )
  }
  function discardVisitor(req) {
    const previous = visitor.read(
      req,
      visitor.cookieName(config),
      config.secret,
      Date.now()
    )
    if (previous) {
      const kept = queue.filter((event) => event.visitorId !== previous.visitor)
      stats.dropped += queue.length - kept.length
      queue = kept
    }
  }
  async function events(req, res) {
    res.setHeader('cache-control', 'no-store')
    const source = origin(req)
    if (!source) {
      stats.rejected++
      return res.status(403).json({ error: 'Origin not allowed.' })
    }
    const secure = source.startsWith('https:')
    const body = req.body
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => !['consent', 'events'].includes(key)) ||
      typeof body.consent !== 'boolean' ||
      !Array.isArray(body.events) ||
      body.events.length > 10
    ) {
      stats.rejected++
      return res.status(400).json({ error: 'Invalid events.' })
    }
    if (body.consent === false && body.events.length === 0) {
      discardVisitor(req)
      visitor.clear(req, res, config, secure)
      return res.status(200).json({ accepted: 0 })
    }
    if (
      !ready() ||
      blocked(req) ||
      (policy.requireConsent && body.consent !== true)
    ) {
      discardVisitor(req)
      visitor.clear(req, res, config, secure)
      stats.rejected++
      return res.status(403).json({ error: 'Collection is disabled.' })
    }
    const now = Date.now(),
      window = Math.floor(now / 60000)
    if (window !== windowStart) {
      windowStart = window
      requests = 0
    }
    if (++requests > 1200 || incoming >= 16) {
      stats.rejected++
      return res.status(429).json({ error: 'Collection busy.' })
    }
    let normalized
    try {
      normalized = body.events
        .map((event) => {
          if (
            !event ||
            typeof event !== 'object' ||
            Object.keys(event).some(
              (key) =>
                ![
                  'id',
                  'kind',
                  'name',
                  'occurredAt',
                  'path',
                  'dimensions'
                ].includes(key)
            ) ||
            !/^[A-Za-z0-9_-]{8,128}$/.test(event.id) ||
            !['pageview', 'goal'].includes(event.kind) ||
            !Number.isSafeInteger(event.occurredAt) ||
            event.occurredAt > now + 300000 ||
            event.occurredAt < now - 300000
          )
            throw new Error('event')
          const eventPath = contract.cleanPath(event.path)
          const name = event.kind === 'pageview' ? 'pageview' : event.name
          if (
            typeof name !== 'string' ||
            !/^[a-z][a-z0-9_.-]{0,63}$/.test(name)
          )
            throw new Error('name')
          return {
            id: event.id,
            kind: event.kind,
            name,
            occurredAt: event.occurredAt,
            path: eventPath,
            dimensions: contract.dimensions(event.dimensions),
            provenance: 'browser'
          }
        })
        .filter((event) => !contract.excluded(event.path, policy, prefix))
    } catch {
      stats.rejected++
      return res.status(400).json({ error: 'Invalid events.' })
    }
    if (!normalized.length) return res.status(200).json({ accepted: 0 })
    incoming++
    const requestEpoch = policyEpoch
    try {
      let ids = { visitorId: null, sessionId: null, hostUserId: null }
      if (policy.mode === 'first-party') {
        if (identityWaiting >= 16)
          return res.status(503).json({ error: 'Identity busy.' })
        identityWaiting++
        const work = identity(req).finally(() => identityWaiting--)
        let timeout
        let principal
        try {
          principal = await Promise.race([
            work,
            new Promise((_, reject) => {
              timeout = setTimeout(
                () => reject(new Error('identity deadline')),
                500
              )
            })
          ])
        } finally {
          clearTimeout(timeout)
        }
        if (res.destroyed) return
        if (requestEpoch !== policyEpoch) {
          visitor.clear(req, res, config, secure)
          return res.status(403).json({ error: 'Collection settings changed.' })
        }
        if (!ready() || blocked(req))
          return res.status(403).json({ error: 'Collection is disabled.' })
        ids = visitor.resolve(req, res, config, principal, secure)
        if (ids.changed)
          return res.status(200).json({ accepted: 0, reset: true })
      } else visitor.clear(req, res, config, secure)
      for (const event of normalized) {
        if (queue.length >= 1000) {
          queue.shift()
          stats.dropped++
        }
        queue.push({
          ...event,
          visitorId: ids.visitorId,
          sessionId: ids.sessionId,
          hostUserId: ids.hostUserId
        })
      }
      stats.received += normalized.length
      if (queue.length >= 100) void flush()
      return res.status(202).json({ accepted: normalized.length })
    } catch {
      stats.rejected++
      return res.status(503).json({ error: 'Collection unavailable.' })
    } finally {
      incoming--
    }
  }
  function configuration(req, res) {
    res.setHeader('cache-control', 'no-store')
    const host = String(req.headers.host || '')
    const allowed = policy.allowedOrigins.some(
      (value) => new URL(value).host === host
    )
    const enabled = allowed && ready() && !blocked(req)
    if (!enabled || policy.mode === 'cookieless')
      visitor.clear(req, res, config, req.secure === true)
    return res.json({
      enabled,
      mode: policy.mode,
      requireConsent: policy.requireConsent,
      respectPrivacySignals: policy.respectPrivacySignals,
      excludedPaths: policy.excludedPaths
    })
  }
  function inject(req, res, args, streamed = false) {
    if (
      !canInject() ||
      streamed ||
      req.method !== 'GET' ||
      res.statusCode < 200 ||
      res.statusCode >= 300 ||
      res.getHeader('content-encoding') ||
      !String(res.getHeader('content-type') || '').includes('text/html') ||
      !allowsSameOriginScript(res.getHeader('content-security-policy')) ||
      contract.excluded(req.originalUrl || req.url, policy, prefix)
    )
      return args
    const original = args[0]
    if (typeof original !== 'string' && !Buffer.isBuffer(original)) return args
    const body = original.toString()
    if (
      Buffer.byteLength(body) > 2097152 ||
      body.includes('data-slipway-wake') ||
      !/<\/body\s*>/i.test(body)
    )
      return args
    const next = body.replace(
      /<\/body\s*>/i,
      `<script async data-slipway-wake src="${prefix}/_slipway/wake.js"></script></body>`
    )
    res.removeHeader('content-length')
    res.removeHeader('etag')
    return [
      Buffer.isBuffer(original) ? Buffer.from(next) : next,
      ...args.slice(1)
    ]
  }
  return {
    resolveIdentity: identity,
    getStatus: () =>
      ready() ? 'collecting' : status === 'collecting' ? 'unavailable' : status,
    getStats: () => ({ ...stats, queued: queue.length }),
    ready,
    canInject,
    events,
    configuration,
    inject,
    flush,
    register,
    script(req, res) {
      res.setHeader('cache-control', 'no-store')
      res.setHeader('content-type', 'application/javascript; charset=utf-8')
      res.setHeader('x-content-type-options', 'nosniff')
      res.end(client)
    },
    start() {
      if (config.enabled !== true) return
      if (
        !/^swk_[a-f0-9]{64}$/.test(config.secret || '') ||
        !/^\d{1,20}$/.test(config.appId || '') ||
        !/^\d{1,20}$/.test(config.deploymentId || '') ||
        config.routeConflict
      ) {
        status = 'invalid_configuration'
        return
      }
      void register()
      timer = setInterval(() => void register(), 60000)
      timer.unref?.()
      flushTimer = setInterval(() => void flush(), 5000)
      flushTimer.unref?.()
    },
    stop() {
      stopped = true
      clearInterval(timer)
      clearInterval(flushTimer)
      for (const request of transports) request.destroy()
      reset('disabled')
    }
  }
}
