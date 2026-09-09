const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const policy = require('./bridge-support-policy')
const overlay = require('./bridge-support-session')
const {
  normalizeRoutePrefix,
  allowsSameOriginScript
} = require('./bearing-widget')
const hash = (value) =>
  crypto.createHash('sha256').update(String(value)).digest('hex')
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[
        c
      ])
  )
module.exports = function supportRuntime(sails) {
  const bridge = sails.config.slipway?.bridge || {}
  const config = policy.configuration(sails)
  const prefix = normalizeRoutePrefix(bridge.routePath)
  const root = `${prefix}/_slipway/bridge/impersonation`
  const localRoot = '/_slipway/bridge/impersonation'
  const cookieName = `slipway_support_${hash(bridge.appId || '').slice(0, 12)}`
  const sessions = new Map()
  const approvedResponses = new WeakSet()
  let timer,
    lease = 0,
    busy = false,
    stopped = false,
    writeGuard
  const script = fs.readFileSync(
    path.join(__dirname, 'bridge-support-client.js'),
    'utf8'
  )
  const css = fs.readFileSync(
    path.join(__dirname, 'bridge-support.css'),
    'utf8'
  )
  const pending = new Set()
  function send(body) {
    const request = sendRequest(body)
    pending.add(request)
    request.then(
      () => pending.delete(request),
      () => pending.delete(request)
    )
    return request
  }
  async function sendRequest(body) {
    const url = new URL(bridge.exchangeUrl)
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      !url.pathname.endsWith('/exchange')
    )
      throw Error('Invalid support exchange URL.')
    url.pathname = url.pathname.replace(/\/exchange$/, '/support')
    const response = await fetch(url, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(3000),
      headers: {
        Authorization: `Bearer ${bridge.secret}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ appId: String(bridge.appId), ...body })
    })
    if (!response.ok) throw Error('Support authorization unavailable.')
    const text = await response.text()
    if (text.length > 65536) throw Error('Invalid support response.')
    return JSON.parse(text)
  }
  const auditOutbox = require('./bridge-support-audit')(
    sails,
    bridge.appId,
    send
  )
  const event = auditOutbox.record
  async function refresh() {
    if (busy || stopped) return
    busy = true
    const checked = [...sessions]
    auditOutbox.flush().catch(() => {})
    try {
      const result = await send({ action: 'status' })
      if (!Array.isArray(result.active)) throw Error('Invalid support status.')
      for (const [key, entry] of checked) {
        if (!result.active.includes(entry.id)) entry.revoked = true
        if (entry.expiresAt + 60000 < Date.now()) sessions.delete(key)
      }
      lease = Date.now() + 30000
    } catch {
      /* The short lease expires locally; host requests never wait on Slipway. */
    } finally {
      busy = false
    }
  }
  function start() {
    if (
      !config.enabled ||
      !bridge.enabled ||
      !bridge.secret ||
      !bridge.exchangeUrl
    )
      return
    refresh()
    timer = setInterval(refresh, 10000)
    timer.unref?.()
  }
  function clear(res) {
    res.clearCookie(cookieName, {
      path: prefix || '/',
      secure: true,
      httpOnly: true,
      sameSite: 'strict'
    })
  }
  function page(res, text, session) {
    approvedResponses.add(res)
    res.set('Cache-Control', 'no-store')
    res.set('Referrer-Policy', 'no-referrer')
    return res
      .status(403)
      .type('html')
      .send(
        `<!doctype html><html><head><title>Slipway support view</title><link rel="stylesheet" href="${root}/style.css"></head><body><main class="slipway-support-message"><h1>Support view</h1><p>${escape(
          text
        )}</p><a href="${root}/stop">Stop viewing</a></main></body></html>`
      )
  }
  async function target(grant, req) {
    if (grant.model !== config.model)
      throw Error('The declared identity model changed.')
    const model = sails.models[config.model]
    if (!model) throw Error('The identity model is unavailable.')
    const record = await model.findOne({
      [model.primaryKey || 'id']: grant.subject
    })
    if (policy.protectedTarget(record))
      throw Error('This target is protected or unavailable.')
    const team = sails.models.team
    if (
      team?.attributes?.owner?.model === config.model &&
      (await team.findOne({ owner: record[model.primaryKey || 'id'] }))
    )
      throw Error('Team owners are protected.')
    const membership = sails.models.teammembership
    if (
      membership?.attributes?.user?.model === config.model &&
      (await membership.findOne({
        user: record[model.primaryKey || 'id'],
        role: { in: ['owner', 'admin', 'administrator'] }
      }))
    )
      throw Error('Administrators are protected.')
    const targetId = record[config.idAttribute]
    if (
      !(
        (typeof targetId === 'string' &&
          targetId.length > 0 &&
          targetId.length <= 256) ||
        Number.isSafeInteger(targetId)
      )
    )
      throw Error('Invalid target identity.')
    let values = {
      [config.sessionKey]: record[config.idAttribute],
      authVersion: record.authVersion || '',
      activeTeamId: record.team?.id || record.team || null
    }
    if (config.helper) {
      if (!/^[a-zA-Z]\w*(?:\.[a-zA-Z]\w*)*$/.test(config.helper))
        throw Error('Invalid identity helper.')
      const helper = config.helper
        .split('.')
        .reduce(
          (node, key) => (Object.hasOwn(node || {}, key) ? node[key] : null),
          sails.helpers
        )
      if (!helper?.with) throw Error('The identity helper is unavailable.')
      const approved = await helper.with({
        req,
        grant: Object.freeze({ ...grant }),
        actor: grant.actor,
        target: record
      })
      if (
        !approved ||
        !approved.session ||
        approved.session[config.sessionKey] !== record[config.idAttribute]
      )
        throw Error('The host did not approve the support identity.')
      values = approved.session
    }
    if (
      values[config.sessionKey] === undefined ||
      values[config.sessionKey] === null
    )
      throw Error('The target has no configured identity.')
    return {
      values,
      name: String(record[config.nameAttribute] || grant.subject).slice(0, 100)
    }
  }
  async function middleware(req, res, next) {
    const pathname = String(req.path || req.url).split('?')[0]
    const endpoint = [root, localRoot].find((base) =>
      pathname.startsWith(base + '/')
    )
    const token = req.cookies?.[cookieName]
    const session = /^[a-f0-9]{64}$/.test(token || '')
      ? sessions.get(hash(token))
      : null
    if (endpoint) {
      const part = pathname.slice(endpoint.length)
      if (req.method === 'GET' && part === '/client.js')
        return res.type('js').send(script)
      if (req.method === 'GET' && part === '/style.css')
        return res.type('css').send(css)
      res.set('Cache-Control', 'no-store')
      res.set('Referrer-Policy', 'no-referrer')
      if (part === '/stop') {
        clear(res)
        if (session) {
          sessions.delete(hash(token))
          event(session, 'stopped').catch(() =>
            sails.log.warn('Support stop audit delivery failed.')
          )
        }
        const returnUrl = session ? session.returnUrl : '/bridge'
        return res.redirect(303, returnUrl)
      }
      if (
        !config.enabled ||
        !bridge.enabled ||
        !bridge.secret ||
        !Array.isArray(config.readOnlyPaths) ||
        !config.readOnlyPaths.length
      )
        return page(res, 'Support viewing is not enabled for this app.')
      if (req.method === 'GET' && part === '/start') {
        if (session)
          return page(
            res,
            'Stop the current support view before starting another.'
          )
        return res
          .type('html')
          .send(
            `<!doctype html><html><head><title>Start Slipway support view</title><link rel="stylesheet" href="${root}/style.css"><script src="${root}/client.js" defer></script></head><body data-slipway-support-start="${root}"><aside id="slipway-support-banner">Starting read-only support view</aside><main class="slipway-support-message"><h1>Starting read-only support view</h1><p id="slipway-support-message">Checking authorization…</p><noscript>JavaScript is required to keep the support banner visible.</noscript><a href="${root}/stop">Cancel</a></main></body></html>`
          )
      }
      if (req.method === 'POST' && part === '/start') {
        if (
          session ||
          sessions.size >= 100 ||
          !req.session ||
          !/^[a-f0-9]{64}$/.test(req.body?.code || '')
        )
          return page(res, 'The support launch is unavailable.')
        let grant
        try {
          const nonce = crypto.randomBytes(32).toString('hex')
          grant = (
            await send({ action: 'exchange', code: req.body.code, nonce })
          ).grant
          if (
            !grant ||
            grant.nonce !== nonce ||
            grant.appId !== String(bridge.appId) ||
            grant.mode !== 'read-only' ||
            grant.expiresAt <= Date.now() ||
            grant.expiresAt > Date.now() + 900000 ||
            !String(grant.returnPath).startsWith('/projects/') ||
            !/^https?:\/\//.test(grant.returnUrl || '')
          )
            throw Error('Invalid support grant.')
          const identity = await target(grant, req)
          await event(grant, 'started', true)
          const value = crypto.randomBytes(32).toString('hex')
          sessions.set(hash(value), { ...grant, ...identity })
          lease = Date.now() + 30000
          res.cookie(cookieName, value, {
            secure: true,
            httpOnly: true,
            sameSite: 'strict',
            path: prefix || '/',
            maxAge: grant.expiresAt - Date.now()
          })
          return res.json({ location: prefix + config.readOnlyPaths[0] })
        } catch {
          if (grant) event(grant, 'denied').catch(() => {})
          return page(
            res,
            'The support grant or target could not be approved. Return to Bridge and try again.'
          )
        }
      }
      if (part === '/status' && req.method === 'GET')
        return res.json({
          active:
            !!session &&
            !session.revoked &&
            Date.now() < session.expiresAt &&
            Date.now() < lease,
          expiresAt: session?.expiresAt || 0
        })
      return page(res, 'This support endpoint is unavailable.')
    }
    if (!token) return next()
    if (
      !session ||
      session.revoked ||
      Date.now() >= session.expiresAt ||
      Date.now() >= lease ||
      !config.enabled
    ) {
      clear(res)
      if (session) {
        sessions.delete(hash(token))
        event(session, 'expired').catch(() => {})
      }
      return page(
        res,
        'This support view ended. Your normal app login is unchanged.'
      )
    }
    const localPath =
      prefix && pathname.startsWith(prefix + '/')
        ? pathname.slice(prefix.length)
        : pathname
    if (['/logout', '/signout'].includes(localPath)) {
      clear(res)
      sessions.delete(hash(token))
      event(session, 'stopped').catch(() =>
        sails.log.warn('Support stop audit delivery failed.')
      )
      return res.redirect(303, session.returnUrl)
    }
    if (/\.(?:js|css|png|jpg|jpeg|svg|woff|woff2|ico)$/.test(localPath)) {
      try {
        const publicRoot = fs.realpathSync(sails.config.paths.public)
        const file = fs.realpathSync(path.resolve(publicRoot, '.' + localPath))
        if (
          file.startsWith(publicRoot + path.sep) &&
          fs.statSync(file).isFile()
        )
          return res.sendFile(file)
      } catch {}
    }
    if (
      !policy.approvedRequest({ method: req.method, path: localPath }, sails)
    ) {
      event(session, 'write_blocked').catch(() =>
        sails.log.warn('Support denial audit delivery failed.')
      )
      return page(
        res,
        'This page or action is not approved for read-only support viewing.',
        session
      )
    }
    try {
      const identity = await target(session, req)
      overlay(req, session, identity.values)
    } catch {
      clear(res)
      sessions.delete(hash(token))
      event(session, 'denied').catch(() =>
        sails.log.warn('Support denial audit delivery failed.')
      )
      return page(res, 'The target is no longer available for support viewing.')
    }
    res.set('Cache-Control', 'no-store')
    res.set('Referrer-Policy', 'no-referrer')
    delete req.headers['if-none-match']
    delete req.headers['if-modified-since']
    const sendResponse = res.send,
      write = res.write,
      end = res.end
    res.end = function (...args) {
      if (!approvedResponses.has(res)) {
        res.destroy()
        return res
      }
      return end.apply(this, args)
    }
    let blocked = false
    res.write = function () {
      blocked = true
      res.destroy()
      return false
    }
    res.send = function (body) {
      const type = String(res.getHeader('content-type') || '')
      if (blocked || res.getHeader('content-disposition')) {
        res.destroy()
        return res
      }
      if (
        typeof body === 'string' &&
        (/^\s*(?:<!doctype|<html)/i.test(body) || type.includes('text/html'))
      ) {
        const csp = String(res.getHeader('content-security-policy') || '')
        const stylePolicy = csp
          .replace(/script-src(?:-elem)?[^;]*;?/g, '')
          .replace(/style-src/g, 'script-src')
        if (
          !body.includes('</body>') ||
          !csp.split(',').every(allowsSameOriginScript) ||
          !stylePolicy.split(',').every(allowsSameOriginScript)
        ) {
          res.send = sendResponse
          res.write = write
          return page(
            res,
            'This page cannot display the required support banner.',
            session
          )
        }
        const nonce = crypto.randomBytes(18).toString('base64')
        if (csp) {
          res.set(
            'Content-Security-Policy',
            csp
              .split(',')
              .map((part) => {
                const rules = part
                  .split(';')
                  .map((rule) => rule.trim())
                  .filter(Boolean)
                for (const name of ['script-src-elem', 'style-src-elem']) {
                  const index = rules.findIndex((rule) =>
                    rule.startsWith(name + ' ')
                  )
                  if (index >= 0) rules[index] += ` 'nonce-${nonce}'`
                  else rules.push(`${name} 'self' 'nonce-${nonce}'`)
                }
                return rules.join('; ')
              })
              .join(', ')
          )
        }
        const banner = `<style nonce="${nonce}">${css}</style><aside id="slipway-support-banner" data-root="${root}" data-expires="${
          session.expiresAt
        }" role="region" aria-label="Slipway support view"><span>Viewing as ${escape(
          session.name
        )} · Read only · <span data-support-time>15 min</span></span><a href="${root}/stop">Stop viewing</a></aside><script nonce="${nonce}">${script}</script>`
        body = body.replace('</body>', banner + '</body>')
        res.removeHeader('Content-Length')
        res.removeHeader('ETag')
      } else if (
        !(
          req.headers['x-inertia'] === 'true' &&
          type.includes('application/json')
        )
      ) {
        res.send = sendResponse
        res.write = write
        return page(
          res,
          'This response is not available in a support view.',
          session
        )
      }
      approvedResponses.add(res)
      res.write = write
      return sendResponse.call(this, body)
    }
    const redirect = res.redirect
    res.redirect = function (status, location) {
      const destination = location || status
      if (
        typeof destination !== 'string' ||
        !destination.startsWith('/') ||
        destination.startsWith('//') ||
        destination.includes('\\')
      ) {
        res.send = sendResponse
        res.write = write
        return page(
          res,
          'This redirect is unavailable in a support view.',
          session
        )
      }
      approvedResponses.add(res)
      return location
        ? redirect.call(this, status, destination)
        : redirect.call(this, destination)
    }
    writeGuard ||= require('./bridge-support-writes')(sails, (entry) =>
      event(entry, 'write_blocked').catch(() =>
        sails.log.warn('Support write audit delivery failed.')
      )
    )
    writeGuard.run(session, next)
  }
  async function stop() {
    stopped = true
    clearInterval(timer)
    sessions.clear()
    writeGuard?.stop()
    await auditOutbox.stop()
    await Promise.allSettled([...pending])
  }
  return { start, stop, middleware, refresh }
}
