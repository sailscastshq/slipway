export function legacyJobEvents(history, jobName) {
  return history
    .filter(
      (event) =>
        event.jobName === jobName &&
        (event.event === 'completed' || event.event === 'failed')
    )
    .slice(0, 20)
}

// eventId is the existing telemetry row identity. It cannot correlate a start
// with a completion, identify a business run, or deduplicate delivery replays.
export function retainLegacyEventSelection(history, jobName, eventId) {
  if (!eventId) return ''
  return legacyJobEvents(history, jobName).some(
    (event) => event.eventId != null && String(event.eventId) === eventId
  )
    ? eventId
    : ''
}
