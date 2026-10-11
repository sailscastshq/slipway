const crypto = require('node:crypto')
const events = new WeakMap()
const prefix = '\u001eSlipwayDeploymentEvent.v1.'
const carrier = /\u001eSlipwayDeploymentEvent\.v1\.([^\u001f\n]{1,8192})\u001f/g
const kinds = new Set([
  'container-start',
  'health-poll',
  'health-passed',
  'access-url'
])

function event(kind, text, valid) {
  if (!valid) return text + '\n'
  const value = Object.freeze(new String(text + '\n'))
  events.set(value, { kind, text })
  return value
}
function host(value) {
  return (
    typeof value === 'string' &&
    /^(?:slipway-[a-z0-9_.-]{1,200}|localhost|127\.0\.0\.1)$/.test(value)
  )
}
function path(value) {
  return (
    typeof value === 'string' &&
    value.length <= 2048 &&
    /^\/[a-z0-9._~/-]*$/i.test(value)
  )
}
function integer(value, min, max) {
  return Number.isSafeInteger(value) && value >= min && value <= max
}
function publicUrl(value) {
  try {
    const url = new URL(value)
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === '/' &&
      (value === url.href.replace(/\/$/, '') || value === url.href)
    )
  } catch {
    return false
  }
}
function containerStart(name) {
  return event(
    'container-start',
    `Starting container: ${name}`,
    host(name) && name.startsWith('slipway-')
  )
}
function healthPoll(name, port, healthPath, seconds) {
  return event(
    'health-poll',
    `Health check: polling http://${name}:${port}${healthPath} (timeout: ${seconds}s)`,
    host(name) &&
      integer(port, 1, 65535) &&
      path(healthPath) &&
      integer(seconds, 0, 86400)
  )
}
function healthPassed(name, port, healthPath, status, attempt) {
  return event(
    'health-passed',
    `Health check passed: http://${name}:${port}${healthPath} returned HTTP ${status} (attempt ${attempt})`,
    host(name) &&
      integer(port, 1, 65535) &&
      path(healthPath) &&
      integer(status, 200, 299) &&
      integer(attempt, 1, 100000)
  )
}
function accessUrl(label, value) {
  return event(
    'access-url',
    `  ${`${label}:`.padEnd(11)}${value}`,
    ['URL', 'Fallback', 'Direct'].includes(label) && publicUrl(value)
  )
}

function createCodec({ secret, diagnosticText, credentialText }) {
  const sign = (payload) =>
    crypto
      .createHmac('sha256', secret)
      .update('slipway-deployment-log-v1:' + payload)
      .digest('base64url')
  function seal(record) {
    const payload = Buffer.from(JSON.stringify(record)).toString('base64url')
    return `${prefix}${payload}.${sign(payload)}\u001f`
  }
  function open(value) {
    if (!secret || typeof secret !== 'string') return null
    const parts = value.split('.')
    if (
      parts.length !== 2 ||
      !/^[a-z0-9_-]+$/i.test(parts[0]) ||
      !/^[a-z0-9_-]{43}$/i.test(parts[1])
    )
      return null
    const signature = Buffer.from(parts[1])
    if (!crypto.timingSafeEqual(signature, Buffer.from(sign(parts[0]))))
      return null
    try {
      const record = JSON.parse(
        Buffer.from(parts[0], 'base64url').toString('utf8')
      )
      return typeof record.deploymentId === 'string' &&
        /^\d+$/.test(record.deploymentId) &&
        kinds.has(record.kind) &&
        typeof record.text === 'string' &&
        record.text.length <= 4096 &&
        !/[\r\n\u001e\u001f]/.test(record.text)
        ? record
        : null
    } catch {
      return null
    }
  }
  function encode(value, deploymentId) {
    const record = value && typeof value === 'object' ? events.get(value) : null
    if (
      !record ||
      !secret ||
      typeof secret !== 'string' ||
      !/^\d+$/.test(String(deploymentId))
    )
      return diagnosticText(untrusted(String(value)))
    return (
      seal({
        deploymentId: String(deploymentId),
        kind: record.kind,
        text: credentialText(record.text)
      }) + '\n'
    )
  }
  function transform(value, deploymentId, storage) {
    const text = String(value || '')
    let output = '',
      offset = 0
    for (const match of text.matchAll(carrier)) {
      output += diagnosticText(text.slice(offset, match.index))
      const record = open(match[1])
      if (!record || (!storage && record.deploymentId !== String(deploymentId)))
        output += '[Unverified deployment event]'
      else {
        const safe = { ...record, text: credentialText(record.text) }
        output += storage ? seal(safe) : safe.text
      }
      offset = match.index + match[0].length
    }
    return output + diagnosticText(text.slice(offset))
  }
  return {
    encode,
    store: (value) => transform(value, null, true),
    render: (value, deploymentId) => transform(value, deploymentId, false)
  }
}
// Docker output cannot acquire provenance by replaying a signed event, even
// when its reserved marker arrives across chunks. Only branded server events
// can enter the persisted carrier format.
function untrusted(value) {
  return value.replaceAll('\u001e', '\\u001e').replaceAll('\u001f', '\\u001f')
}
module.exports = {
  containerStart,
  healthPoll,
  healthPassed,
  accessUrl,
  createCodec,
  untrusted
}
