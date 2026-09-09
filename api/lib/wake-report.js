const store = require('./wake-store')
const {
  DAY,
  RETENTION_DAYS
} = require('../../packages/hook/lib/wake-value-contract')
function range(query = {}, now = Date.now()) {
  const today = Math.floor(now / DAY) * DAY
  const parse = (text, fallback) => {
    if (!text) return fallback
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw Error('Invalid UTC date')
    const n = Date.parse(text + 'T00:00:00Z')
    if (!Number.isFinite(n) || new Date(n).toISOString().slice(0, 10) !== text)
      throw Error('Invalid UTC date')
    return n
  }
  const from = parse(query.from, today - 6 * DAY),
    through = parse(query.to, today)
  if (
    from > through ||
    from < today - (RETENTION_DAYS - 1) * DAY ||
    through > today
  )
    throw Error('Choose a date range within the last thirteen months.')
  const currency = query.currency || 'USD'
  if (!Intl.supportedValuesOf('currency').includes(currency))
    throw Error('Invalid currency')
  return {
    from,
    to: through + DAY,
    currency,
    fromText: new Date(from).toISOString().slice(0, 10),
    toText: new Date(through).toISOString().slice(0, 10)
  }
}
function report(app, filters) {
  const db = store.database(),
    id = String(app.id),
    { from, to, currency } = filters,
    args = [id, from, to]
  const one = (sql, bindings = args) => db.prepare(sql).get(...bindings),
    all = (sql, bindings = args) => db.prepare(sql).all(...bindings)
  const measurable = app.wakeSettings?.mode !== 'cookieless'
  const visitors = one(
    'SELECT COUNT(DISTINCT visitor_id) AS n FROM wake_members WHERE app=? AND day>=? AND day<?'
  ).n
  const signup = one(
    "SELECT COUNT(DISTINCT visitor_id) AS n FROM wake_members WHERE app=? AND day>=? AND day<? AND name='signup' AND provenance='server'"
  ).n
  const amounts = one(
    'SELECT COALESCE(SUM(CASE WHEN adjustment_id IS NULL THEN amount ELSE 0 END),0) gross,COALESCE(SUM(CASE WHEN adjustment_id IS NOT NULL THEN amount ELSE 0 END),0) refunds,COALESCE(SUM(CASE WHEN visitor_id IS NULL THEN CASE WHEN adjustment_id IS NULL THEN amount ELSE -amount END ELSE 0 END),0) unattributed,COUNT(DISTINCT CASE WHEN adjustment_id IS NULL THEN visitor_id END) paying FROM wake_receipts WHERE app=? AND occurred_at>=? AND occurred_at<? AND currency=?',
    [...args, currency]
  )
  const attributed = one(
    'SELECT COALESCE(SUM(CASE WHEN adjustment_id IS NULL THEN amount ELSE -amount END),0) AS n FROM wake_receipts WHERE app=? AND occurred_at>=? AND occurred_at<? AND currency=? AND visitor_id IN (SELECT visitor_id FROM wake_members WHERE app=? AND day>=? AND day<?)',
    [...args, currency, ...args]
  ).n
  if (
    !Object.values(amounts).every(Number.isSafeInteger) ||
    !Number.isSafeInteger(attributed)
  )
    throw Error('Revenue totals exceed the safe reporting range')
  const goals = all(
    "SELECT name,provenance,SUM(count) AS count FROM wake_daily WHERE app=? AND day>=? AND day<? AND kind='goal' GROUP BY name,provenance ORDER BY count DESC LIMIT 50"
  ).map((goal) => ({
    ...goal,
    visitors: measurable
      ? one(
          'SELECT COUNT(DISTINCT visitor_id) AS n FROM wake_members WHERE app=? AND day>=? AND day<? AND name=? AND provenance=?',
          [...args, goal.name, goal.provenance]
        ).n
      : null
  }))
  const recordedDays = all(
    "SELECT day,SUM(CASE WHEN kind='pageview' THEN count ELSE 0 END) AS pageviews,SUM(CASE WHEN kind='goal' THEN count ELSE 0 END) AS goals FROM wake_daily WHERE app=? AND day>=? AND day<? GROUP BY day ORDER BY day"
  )
  const byDay = new Map(recordedDays.map((day) => [day.day, day]))
  const trend = Array.from(
    { length: Math.ceil((to - from) / DAY) },
    (_, index) =>
      byDay.get(from + index * DAY) || {
        day: from + index * DAY,
        pageviews: 0,
        goals: 0
      }
  )
  const sources = all(
    'SELECT source,campaign,SUM(count) AS events FROM wake_daily WHERE app=? AND day>=? AND day<? GROUP BY source,campaign ORDER BY events DESC LIMIT 20'
  )
  const landing = all(
    "SELECT json_extract(first_touch,'$.path') AS path,COUNT(*) AS visitors FROM wake_visitors WHERE app=? AND first_at>=? AND first_at<? GROUP BY path ORDER BY visitors DESC LIMIT 20"
  )
  const currencies = all(
    'SELECT DISTINCT currency FROM wake_receipts WHERE app=? ORDER BY currency',
    [id]
  ).map((r) => r.currency)
  const health = one('SELECT * FROM wake_health WHERE app=?', [id]) || {}
  const oldest = one(
    'SELECT MIN(occurred_at) AS at FROM wake_events WHERE app=?',
    [id]
  ).at
  const pending = one(
    'SELECT COUNT(*) AS n FROM wake_events WHERE app=? AND aggregated=0',
    [id]
  ).n
  const size =
    one('PRAGMA page_count', []).page_count *
    one('PRAGMA page_size', []).page_size
  return {
    visitors: measurable ? visitors : null,
    sessions: measurable
      ? one(
          'SELECT COUNT(*) AS n FROM wake_sessions WHERE app=? AND started_at>=? AND started_at<?'
        ).n
      : null,
    signups: signup,
    conversion: measurable && visitors ? signup / visitors : null,
    goals,
    trend,
    sources,
    landing: measurable ? landing : [],
    currencies,
    revenue: {
      ...amounts,
      net: amounts.gross - amounts.refunds,
      paying: measurable ? amounts.paying : null,
      perVisitor: measurable && visitors ? attributed / visitors : null
    },
    health: {
      ...health,
      oldestRawAt: oldest,
      pendingBackfill: pending,
      hostBytes: size
    },
    measurable
  }
}
function journeys(app, filters, visitorId) {
  const db = store.database(),
    id = String(app.id)
  if (app.wakeSettings?.mode === 'cookieless')
    return { visitors: [], events: [], receipts: [] }
  const visitors = db
    .prepare(
      'SELECT visitor_id,first_at,last_at,first_touch,last_touch FROM wake_visitors WHERE app=? AND last_at>=? AND first_at<? ORDER BY last_at DESC LIMIT 50'
    )
    .all(id, filters.from, filters.to)
  if (!visitorId) return { visitors, events: [], receipts: [] }
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(visitorId)) throw Error('Invalid visitor')
  return {
    visitors,
    events: db
      .prepare(
        'SELECT kind,name,occurred_at,path,provenance,properties FROM wake_events WHERE app=? AND visitor_id=? AND occurred_at>=? AND occurred_at<? ORDER BY occurred_at LIMIT 200'
      )
      .all(id, visitorId, filters.from, filters.to),
    receipts: db
      .prepare(
        'SELECT transaction_id,adjustment_id,amount,currency,occurred_at FROM wake_receipts WHERE app=? AND visitor_id=? AND occurred_at>=? AND occurred_at<? ORDER BY occurred_at LIMIT 200'
      )
      .all(id, visitorId, filters.from, filters.to)
  }
}
module.exports = { range, report, journeys }
