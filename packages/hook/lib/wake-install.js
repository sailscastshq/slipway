const { normalizeRoutePrefix } = require('./bearing-widget')
module.exports = function installWake(sails, config, runtime) {
  if (!config.enabled) return
  const prefix = normalizeRoutePrefix(config.routePath)
  const paths = [...new Set(['', prefix])]
  const routes = (sails.config.routes ||= {})
  const addresses = paths.flatMap((path) => [
    `GET ${path}/_slipway/wake.js`,
    `GET ${path}/_slipway/wake/config`,
    `POST ${path}/_slipway/wake/events`
  ])
  if (addresses.some((address) => routes[address])) {
    config.routeConflict = true
    sails.log?.warn(
      'Wake routes conflict with application routes; collection is disabled.'
    )
    return
  }
  const middleware = sails.config.http?.middleware
  if (
    !middleware ||
    !Array.isArray(middleware.order) ||
    !middleware.order.includes('bodyParser')
  ) {
    config.routeConflict = true
    sails.log?.warn(
      'Wake requires an HTTP bodyParser middleware slot; collection is disabled.'
    )
    return
  }
  for (const path of paths) {
    routes[`GET ${path}/_slipway/wake.js`] = {
      fn: (req, res) => runtime().script(req, res)
    }
    routes[`GET ${path}/_slipway/wake/config`] = {
      fn: (req, res) => runtime().configuration(req, res)
    }
    routes[`POST ${path}/_slipway/wake/events`] = {
      csrf: false,
      fn: (req, res) => runtime().events(req, res)
    }
  }
  // Parse only Wake's explicitly reserved routes before the host parser. Skipper
  // and Express JSON parsers honor _body, so application auth middleware still runs.
  middleware.wakeBodyParser = (req, res, next) => {
    const pathname = String(req.url || '')
      .split('?')[0]
      .replace(/\/$/, '')
      .toLowerCase()
    if (
      req.method !== 'POST' ||
      !paths.some(
        (path) => pathname === `${path}/_slipway/wake/events`.toLowerCase()
      )
    )
      return next()
    if (
      !/^(?:application\/json|text\/plain)(?:\s*;|$)/i.test(
        String(req.headers['content-type'] || '')
      ) ||
      req.headers['content-encoding']
    )
      return res.status(415).json({ error: 'Unsupported event format.' })
    if (Number(req.headers['content-length']) > 16384) {
      req.resume()
      return res.status(413).json({ error: 'Event batch too large.' })
    }
    let chunks = [],
      bytes = 0,
      finished = false
    const fail = (code) => {
      if (finished) return
      finished = true
      clearTimeout(deadline)
      chunks = []
      res.status(code).json({ error: 'Invalid event batch.' })
      req.resume()
    }
    const deadline = setTimeout(() => fail(408), 3000)
    deadline.unref?.()
    req.on('data', (chunk) => {
      if (finished) return
      bytes += chunk.length
      if (bytes > 16384) return fail(413)
      chunks.push(chunk)
    })
    req.on('error', () => fail(400))
    req.on('end', () => {
      if (finished) return
      try {
        req.body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        req._body = true
      } catch {
        return fail(400)
      }
      finished = true
      clearTimeout(deadline)
      chunks = []
      next()
    })
  }
  middleware.order.splice(
    middleware.order.indexOf('bodyParser'),
    0,
    'wakeBodyParser'
  )
}
