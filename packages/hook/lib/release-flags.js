const crypto = require('crypto')
const http = require('http')
const https = require('https')

function createReleaseFlags(options = {}) {
  const url = options.url
  const token = options.token
  const refreshInterval = options.refreshInterval || 15000
  const requestTimeout = options.requestTimeout || 3000
  const requestJson = options.requestJson || fetchJson
  const now = options.now || Date.now
  let snapshot = null
  let fetchedAt = 0
  let inFlight = null

  async function refresh() {
    if (!url || !token) return null
    if (inFlight) return inFlight

    inFlight = requestJson({ url, token, timeout: requestTimeout })
      .then((payload) => {
        snapshot = {
          version: payload.version || null,
          capabilities:
            payload.capabilities && typeof payload.capabilities === 'object'
              ? payload.capabilities
              : {},
          flags: new Map(
            (Array.isArray(payload.flags) ? payload.flags : []).map((flag) => [
              flag.key,
              flag
            ])
          )
        }
        fetchedAt = now()
        return snapshot
      })
      .finally(() => {
        inFlight = null
      })

    return inFlight
  }

  async function evaluate({ key, context, defaultValue = false }) {
    if (!snapshot) {
      refresh().catch(() => {})
      return result(defaultValue, 'default', null)
    } else if (now() - fetchedAt >= refreshInterval) {
      refresh().catch(() => {})
    }

    const flag = snapshot?.flags.get(key)
    if (!flag) return result(defaultValue, 'default', snapshot?.version)
    if (flag.enabled !== true) {
      return result(false, 'disabled', snapshot.version, flag.version)
    }

    const normalizedContext = normalizeContext(context)
    const targets = Array.isArray(flag.targets) ? flag.targets : []
    if (targets.some((target) => matchesTarget(target, normalizedContext))) {
      return result(true, 'targeted', snapshot.version, flag.version)
    }

    const percentage = Math.max(
      0,
      Math.min(100, Number(flag.rolloutPercentage) || 0)
    )
    if (percentage === 100) {
      return result(true, 'rollout', snapshot.version, flag.version)
    }
    if (percentage === 0) {
      return result(false, 'rollout', snapshot.version, flag.version)
    }

    const targetingKey = stableTargetingKey(normalizedContext)
    if (!targetingKey) {
      return result(false, 'missing-context', snapshot.version, flag.version)
    }

    return result(
      bucket(`${key}:${targetingKey}`) < percentage,
      'rollout',
      snapshot.version,
      flag.version
    )
  }

  function getCapability(name) {
    if (!snapshot) {
      refresh().catch(() => {})
    } else if (now() - fetchedAt >= refreshInterval) {
      refresh().catch(() => {})
    }
    return snapshot?.capabilities?.[name] || null
  }

  return { evaluate, getCapability, refresh }
}

function normalizeContext(context = {}) {
  const normalized = {}
  for (const type of ['user', 'account', 'tenant', 'team', 'session']) {
    const candidate = context[type]
    const value =
      candidate && typeof candidate === 'object' && candidate.id != null
        ? candidate.id
        : candidate
    if (value !== undefined && value !== null && String(value).trim()) {
      normalized[type] = String(value).trim()
    }
  }
  return normalized
}

function matchesTarget(target, context) {
  const separator = String(target).indexOf(':')
  if (separator < 1) return false
  const type = target.slice(0, separator)
  const value = target.slice(separator + 1)
  return context[type] === value
}

function stableTargetingKey(context) {
  for (const type of ['user', 'account', 'tenant', 'team', 'session']) {
    if (context[type]) return `${type}:${context[type]}`
  }
  return null
}

function bucket(value) {
  return (
    crypto.createHash('sha256').update(value).digest().readUInt32BE(0) % 100
  )
}

function result(value, reason, configVersion, flagVersion) {
  return {
    value: value === true,
    reason,
    configVersion: configVersion || null,
    flagVersion: flagVersion || null
  }
}

function fetchJson({ url, token, timeout }) {
  return new Promise((resolve, reject) => {
    let endpoint
    try {
      endpoint = new URL(url)
    } catch {
      return reject(new Error('The release flag URL is invalid.'))
    }

    const transport = endpoint.protocol === 'https:' ? https : http
    const request = transport.request(
      {
        hostname: endpoint.hostname,
        port: endpoint.port,
        path: `${endpoint.pathname}${endpoint.search}`,
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        timeout
      },
      (response) => {
        let body = ''
        response.on('data', (chunk) => {
          body += chunk
          if (body.length > 2 * 1024 * 1024) {
            response.destroy(
              new Error('The release flag response was too large.')
            )
          }
        })
        response.on('end', () => {
          let payload
          try {
            payload = body ? JSON.parse(body) : {}
          } catch {
            return reject(new Error('The release flag response was invalid.'))
          }
          if (response.statusCode < 200 || response.statusCode >= 300) {
            return reject(
              new Error(
                `Release flag fetch returned HTTP ${response.statusCode}.`
              )
            )
          }
          return resolve(payload)
        })
      }
    )
    request.on('error', reject)
    request.on('timeout', () => {
      request.destroy(new Error('Release flag fetch timed out.'))
    })
    request.end()
  })
}

module.exports = {
  createReleaseFlags,
  normalizeContext,
  stableTargetingKey,
  bucket
}
