const LIMITS = Object.freeze({
  bytes: 65536,
  events: 100,
  requestsPerMinute: 120,
  eventsPerMinute: 3000,
  bytesPerMinute: 2097152
})
function normalize(events, now = Date.now()) {
  if (
    !Array.isArray(events) ||
    events.length < 1 ||
    events.length > LIMITS.events
  )
    throw new Error('invalid events')
  return events.map((event) => {
    const fields = [
      'id',
      'kind',
      'name',
      'occurredAt',
      'path',
      'visitorId',
      'sessionId'
    ]
    if (
      !event ||
      typeof event !== 'object' ||
      Array.isArray(event) ||
      Object.keys(event).some((key) => !fields.includes(key))
    )
      throw new Error('invalid event')
    const identifier = (value) =>
      typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value)
    if (!identifier(event.id) || !['pageview', 'goal'].includes(event.kind))
      throw new Error('invalid type')
    if (
      !Number.isSafeInteger(event.occurredAt) ||
      event.occurredAt > now + 300000 ||
      event.occurredAt < now - 30 * 86400000
    )
      throw new Error('invalid time')
    if (
      typeof event.path !== 'string' ||
      !event.path.startsWith('/') ||
      event.path.startsWith('//') ||
      event.path.length > 2048 ||
      /[\x00-\x20\\]/.test(event.path)
    )
      throw new Error('invalid path')
    const path = event.path.split(/[?#]/, 1)[0]
    const name = event.kind === 'pageview' ? 'pageview' : event.name
    if (typeof name !== 'string' || !/^[a-z][a-z0-9_.-]{0,63}$/.test(name))
      throw new Error('invalid goal')
    for (const key of ['visitorId', 'sessionId'])
      if (event[key] != null && !identifier(event[key]))
        throw new Error('invalid identifier')
    return {
      id: event.id,
      kind: event.kind,
      name,
      occurredAt: event.occurredAt,
      path,
      visitorId: event.visitorId || null,
      sessionId: event.sessionId || null
    }
  })
}
async function budget(db, app, events, bytes, now = Date.now()) {
  const window = Math.floor(now / 60000) * 60000
  await db.sendNativeQuery(
    `INSERT INTO wake_budgets(app, window_start) VALUES (?, ?)
    ON CONFLICT(app) DO UPDATE SET window_start=excluded.window_start, requests=0, events=0, bytes=0 WHERE wake_budgets.window_start < excluded.window_start`,
    [app, window]
  )
  const result = await db.sendNativeQuery(
    `UPDATE wake_budgets SET requests=requests+1, events=events+?, bytes=bytes+?
    WHERE app=? AND window_start=? AND requests<? AND events+?<=? AND bytes+?<=?`,
    [
      events,
      bytes,
      app,
      window,
      LIMITS.requestsPerMinute,
      events,
      LIMITS.eventsPerMinute,
      bytes,
      LIMITS.bytesPerMinute
    ]
  )
  if (result.changes === 1) return true
  await db.sendNativeQuery(
    'UPDATE wake_budgets SET rejected=rejected+1 WHERE app=?',
    [app]
  )
  return false
}
module.exports = { LIMITS, normalize, budget }
