const crypto = require('node:crypto')

const sessions = new Map()
const devices = new Map()
const streams = new Set()
const MAX_SESSIONS = 1024
const MAX_STREAMS = 128
const TTL = 5 * 60 * 1000
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex')

function remove(code) {
  const session = sessions.get(code)
  if (session) devices.delete(session.deviceHash)
  sessions.delete(code)
}

function get(code) {
  const session = sessions.get(code)
  if (session && session.expiresAt > Date.now()) return session
  remove(code)
  return null
}

function prune() {
  for (const code of sessions.keys()) get(code)
}
const cleanup = setInterval(prune, 60000)
cleanup.unref?.()

function deviceSession(deviceCode) {
  if (!/^[a-f0-9]{64}$/.test(deviceCode || '')) return null
  return get(devices.get(hash(deviceCode)))
}

module.exports = {
  friendlyName: 'CLI auth sessions',
  description:
    'Bounded device authorization with separate human and device secrets.',
  sync: true,
  inputs: {},
  fn: function () {
    return {
      create() {
        prune()
        if (sessions.size >= MAX_SESSIONS) return null
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
        let code
        do {
          code = Array.from(
            { length: 8 },
            () => chars[crypto.randomInt(chars.length)]
          ).join('')
        } while (sessions.has(code))
        const deviceCode = crypto.randomBytes(32).toString('hex')
        const deviceHash = hash(deviceCode)
        const expiresAt = Date.now() + TTL
        sessions.set(code, { code, deviceHash, expiresAt, status: 'pending' })
        devices.set(deviceHash, code)
        return { code, deviceCode, expiresAt }
      },
      // Browser code lookup never exposes the device secret or CLI token.
      get(code) {
        const session = get(code)
        return session
          ? { status: session.status, expiresAt: session.expiresAt }
          : null
      },
      claim(code) {
        const session = get(code)
        if (!session || session.status !== 'pending') return false
        session.status = 'confirming'
        return true
      },
      releaseClaim(code) {
        const session = get(code)
        if (session?.status === 'confirming') session.status = 'pending'
      },
      confirm(code, user, sessionToken) {
        const session = get(code)
        if (!session || session.status !== 'confirming') return false
        Object.assign(session, { status: 'authenticated', user, sessionToken })
        return true
      },
      readDevice(deviceCode) {
        const session = deviceSession(deviceCode)
        if (!session) return null
        if (session.status !== 'authenticated') return { status: 'pending' }
        const result = {
          status: 'authenticated',
          token: session.sessionToken,
          user: session.user
        }
        remove(session.code)
        return result
      },
      acquireStream(deviceCode) {
        const session = deviceSession(deviceCode)
        if (
          !session ||
          streams.size >= MAX_STREAMS ||
          streams.has(session.deviceHash)
        )
          return null
        streams.add(session.deviceHash)
        return () => streams.delete(session.deviceHash)
      },
      delete: remove
    }
  }
}
