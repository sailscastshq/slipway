const { test } = require('sounding')
const sessions = require('../../../../api/helpers/cli/auth-sessions').fn()

test('device credentials are separate, single use, and invisible to public code lookup', ({
  expect
}) => {
  const { code, deviceCode } = sessions.create()
  try {
    expect(sessions.readDevice(code)).toBe(null)
    expect(sessions.confirm(code, { id: 1 }, 'unsaved')).toBe(false)
    expect(sessions.claim(code)).toBe(true)
    expect(sessions.claim(code)).toBe(false)
    expect(sessions.readDevice(deviceCode)).toEqual({ status: 'pending' })
    expect(sessions.confirm(code, { id: 1 }, 'persisted')).toBe(true)
    expect(sessions.confirm(code, { id: 2 }, 'replacement')).toBe(false)
    expect(sessions.get(code).sessionToken).toBe(undefined)
    expect(sessions.get(code).deviceCode).toBe(undefined)
    expect(sessions.readDevice(deviceCode).token).toBe('persisted')
    expect(sessions.readDevice(deviceCode)).toBe(null)
  } finally {
    sessions.delete(code)
  }
})

test('CLI authorization bounds pending allocations and simultaneous streams', ({
  expect
}) => {
  const created = []
  const releases = []
  try {
    for (let i = 0; i < 1024; i++) created.push(sessions.create())
    expect(created.every(Boolean)).toBe(true)
    expect(sessions.create()).toBe(null)
    for (let i = 0; i < 128; i++)
      releases.push(sessions.acquireStream(created[i].deviceCode))
    expect(releases.every((release) => typeof release === 'function')).toBe(
      true
    )
    expect(sessions.acquireStream(created[128].deviceCode)).toBe(null)
    expect(sessions.acquireStream(created[0].deviceCode)).toBe(null)
    releases[0]()
    const replacement = sessions.acquireStream(created[128].deviceCode)
    expect(typeof replacement).toBe('function')
    replacement()
  } finally {
    releases.forEach((release) => release?.())
    created.forEach((session) => sessions.delete(session.code))
  }
})
