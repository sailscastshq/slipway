module.exports = async function telemetryBudget({
  environment,
  events,
  bytes,
  invalid = false,
  now = Date.now()
}) {
  const db = sails.getDatastore('observability')
  const window = Math.floor(now / 60000) * 60000
  const limits = sails.config.custom.observability || {}
  await db.sendNativeQuery(
    `INSERT OR IGNORE INTO telemetry_ingestion_budgets
    (environment, window_start, events, bytes, requests, rejected_events, rejected_requests, created_at, updated_at)
    VALUES (?, ?, 0, 0, 0, 0, 0, ?, ?)`,
    [String(environment), window, now, now]
  )
  await db.sendNativeQuery(
    `UPDATE telemetry_ingestion_budgets SET window_start=?, events=0, bytes=0, requests=0
    WHERE environment=? AND window_start < ?`,
    [window, String(environment), window]
  )
  let accepted = false
  if (!invalid) {
    const result = await db.sendNativeQuery(
      `UPDATE telemetry_ingestion_budgets SET events=events+?, bytes=bytes+?, requests=requests+1, updated_at=?
      WHERE environment=? AND window_start=? AND events+?<=? AND bytes+?<=? AND requests<?`,
      [
        events,
        bytes,
        now,
        String(environment),
        window,
        events,
        limits.ingestionEventsPerMinute || 3000,
        bytes,
        limits.ingestionBytesPerMinute || 2097152,
        limits.ingestionRequestsPerMinute || 120
      ]
    )
    accepted = result.changes === 1
  }
  if (!accepted)
    await db.sendNativeQuery(
      `UPDATE telemetry_ingestion_budgets SET rejected_events=rejected_events+?, rejected_requests=rejected_requests+1, updated_at=? WHERE environment=?`,
      [events, now, String(environment)]
    )
  return accepted
}
