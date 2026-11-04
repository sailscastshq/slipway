const { initialState, observe, statusAt } = require('./availability')

// Example observations exercise the same state reducer as the checker. They
// are never persisted, ingested, or presented as observations of the real app.
function example(scenario, now = Date.now()) {
  const end = Math.floor(now / 60000) * 60000
  let state = initialState()
  const timeline = []
  const incidents = []
  for (let index = 0; index < 60; index++) {
    const checkedAt = end - (59 - index) * 60000
    const missing =
      (index >= 39 && index <= 42) || (scenario === 'stale' && index >= 55)
    const outcome = missing
      ? 'unknown'
      : (index >= 20 && index <= 23) || (scenario === 'down' && index >= 57)
      ? 'down'
      : 'up'
    const observation = {
      checkedAt,
      outcome,
      durationMs: outcome === 'unknown' ? null : 120 + ((index * 13) % 75),
      statusCode: outcome === 'unknown' ? null : outcome === 'down' ? 503 : 200
    }
    timeline.push(observation)
    if (missing) continue
    const result = observe(state, observation)
    state = result.state
    if (result.event?.type === 'incident_opened') {
      incidents.unshift({
        openedAt: result.event.at,
        resolvedAt: null,
        deployment: 'example-a12bc34',
        reason: 'HTTP 503 confirmed twice'
      })
    }
    if (result.event?.type === 'incident_resolved') {
      incidents[0].resolvedAt = result.event.at
    }
  }
  return {
    scenario,
    status: statusAt(state, now),
    target: 'https://example.com/health',
    state,
    timeline,
    incidents,
    latest: timeline.filter((point) => point.outcome !== 'unknown').at(-1)
  }
}

module.exports = { example }
