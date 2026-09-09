const http = require('node:http')
const https = require('node:https')
const resolveIdentity = require('./wake-identity')

module.exports = function createWakeRuntime(sails, config, hookVersion) {
  let stopped = false
  let timer
  let active
  let lastIdentityWarning = 0
  let status = 'disabled'
  function identity(req) {
    return resolveIdentity(sails, req, () => {
      if (Date.now() - lastIdentityWarning < 60000) return
      lastIdentityWarning = Date.now()
      sails.log?.warn(
        'Wake identity is unavailable; permitted activity remains anonymous.'
      )
    })
  }
  function register() {
    if (stopped || active) return
    let url
    try {
      url = new URL(config.ingestUrl)
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        !url.pathname.endsWith('/ingest')
      )
        throw new Error('invalid url')
      url.pathname = url.pathname.replace(/\/ingest$/, '/register')
      url.search = ''
      url.hash = ''
    } catch {
      status = 'invalid_configuration'
      return
    }
    const body = JSON.stringify({
      appId: config.appId,
      deploymentId: config.deploymentId,
      protocol: 1,
      hookVersion
    })
    status = 'connecting'
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
        if (response.statusCode === 401) {
          status = 'revoked'
          clearInterval(timer)
          response.resume()
          return
        }
        if (response.statusCode !== 200) {
          status = 'unavailable'
          response.resume()
          return
        }
        let body = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => {
          body += chunk
          if (Buffer.byteLength(body) > 4096) {
            status = 'unavailable'
            response.destroy()
          }
        })
        response.on('error', () => {
          status = 'unavailable'
        })
        response.on('end', () => {
          try {
            const result = JSON.parse(body)
            status =
              result.protocol === 1 &&
              result.collectionReady === false &&
              result.leaseMs === 0
                ? 'foundation_only'
                : 'unavailable'
          } catch {
            status = 'unavailable'
          }
        })
      }
    )
    active = request
    // An absolute deadline bounds DNS, connect, response and slow-drip peers.
    const deadline = setTimeout(() => request.destroy(), 3000)
    deadline.unref?.()
    request.on('error', () => {
      if (!stopped) status = 'unavailable'
    })
    request.on('close', () => {
      clearTimeout(deadline)
      active = null
    })
    request.end(body)
  }
  return {
    resolveIdentity: identity,
    getStatus: () => status,
    start() {
      if (config.enabled !== true) return
      if (
        !/^swk_[a-f0-9]{64}$/.test(config.secret || '') ||
        !/^\d{1,20}$/.test(config.appId || '') ||
        !/^\d{1,20}$/.test(config.deploymentId || '')
      ) {
        status = 'invalid_configuration'
        return
      }
      register()
      timer = setInterval(register, 60000)
      timer.unref?.()
    },
    stop() {
      stopped = true
      clearInterval(timer)
      active?.destroy()
    }
  }
}
