const dns = require('node:dns').promises
const http = require('node:http')
const https = require('node:https')
const { BlockList, isIP } = require('node:net')

// Conservative public Internet policy. IPv6 transition mechanisms are excluded
// so an apparently public IPv6 address cannot tunnel to a private IPv4 target.
const blocked = new BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3]
])
  blocked.addSubnet(address, prefix, 'ipv4')
// Azure's platform virtual IP is globally numbered but is not a public target.
blocked.addAddress('168.63.129.16', 'ipv4')
const globalV6 = new BlockList()
globalV6.addSubnet('2000::', 3, 'ipv6')
for (const [address, prefix] of [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20]
])
  blocked.addSubnet(address, prefix, 'ipv6')

function isPublicAddress(address) {
  const family = isIP(address)
  if (family === 4) return !blocked.check(address, 'ipv4')
  return (
    family === 6 &&
    globalV6.check(address, 'ipv6') &&
    !blocked.check(address, 'ipv6')
  )
}

function parseTarget(value) {
  const url = new URL(value)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error('BEACON_INVALID_TARGET')
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (!hostname || (isIP(hostname) && !isPublicAddress(hostname))) {
    throw new Error('BEACON_BLOCKED_TARGET')
  }
  // Ports are intentionally limited in the initial public-site checker.
  if (url.port) throw new Error('BEACON_INVALID_TARGET')
  url.hash = ''
  return { url, hostname }
}

/** One bounded observation. Dependencies are injectable for network-free trials. */
async function probe(value, { timeoutMs = 10000 } = {}, dependencies = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) {
    throw new Error('BEACON_INVALID_TIMEOUT')
  }
  const { url, hostname } = parseTarget(value)
  const started = performance.now()
  const checkedAt = Date.now()
  const resolver = dependencies.lookup ? null : new dns.Resolver()
  const lookup =
    dependencies.lookup ||
    (async (host) => {
      const results = await Promise.allSettled([
        resolver.resolve4(host),
        resolver.resolve6(host)
      ])
      const answers = results.flatMap((result, index) =>
        result.status === 'fulfilled'
          ? result.value.map((address) => ({
              address,
              family: index === 0 ? 4 : 6
            }))
          : []
      )
      if (!answers.length) throw new Error('BEACON_DNS_FAILED')
      return answers
    })
  const request =
    dependencies.request ||
    (url.protocol === 'https:' ? https.request : http.request)
  let req
  let timer
  let finished = false
  return new Promise((resolve) => {
    const finish = (result) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      resolver?.cancel()
      resolve({
        checkedAt,
        durationMs: Math.round(performance.now() - started),
        ...result
      })
      req?.destroy()
    }
    timer = setTimeout(
      () => finish({ outcome: 'down', reason: 'timeout' }),
      timeoutMs
    )
    ;(async () => {
      try {
        const answers = isIP(hostname)
          ? [{ address: hostname, family: isIP(hostname) }]
          : await lookup(hostname, { all: true, verbatim: true })
        if (finished) return
        // Reject mixed public/private DNS instead of selecting only a safe answer.
        if (
          !answers.length ||
          !answers.every(
            ({ address, family }) =>
              isPublicAddress(address) && family === isIP(address)
          )
        ) {
          return finish({ outcome: 'unknown', reason: 'blocked_target' })
        }
        const selected = answers[0]
        req = request(
          url,
          {
            method: 'GET',
            agent: false,
            rejectUnauthorized: true,
            maxHeaderSize: 16384,
            headers: {
              'User-Agent': 'Slipway-Beacon/0.1',
              Connection: 'close'
            },
            // Keep URL hostname for Host/SNI/certificate checks, but connect only
            // to this already validated address (no second DNS resolution).
            lookup: (_hostname, options, callback) => {
              if (options.all) callback(null, [selected])
              else callback(null, selected.address, selected.family)
            }
          },
          (response) => {
            const statusCode = response.statusCode
            response.on('error', () => {})
            // Never buffer response bodies or follow redirects. A 3xx is a
            // diagnostic failure until explicit redirect policy is implemented.
            response.destroy()
            finish({
              outcome: statusCode >= 200 && statusCode < 300 ? 'up' : 'down',
              reason: 'http',
              statusCode
            })
          }
        )
        req.on('error', () => finish({ outcome: 'down', reason: 'network' }))
        req.end()
      } catch (_) {
        finish({ outcome: 'down', reason: 'network' })
      }
    })()
  })
}

module.exports = { probe, parseTarget, isPublicAddress }
