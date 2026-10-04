module.exports = {
  friendlyName: 'Queue resource alert',
  description:
    'Create an idempotent incident delivery before advancing its detection state.',
  inputs: {
    payload: { type: 'ref', required: true },
    previousSampleAt: { type: 'number', required: true }
  },
  fn: async function ({ payload, previousSampleAt }) {
    const resource = payload.cpuHigh ? 'cpu' : 'memory'
    const incidentKey = `${payload.containerName}:${resource}:${previousSampleAt}`
    const now = payload.observedAt
    await sails.getDatastore('observability').sendNativeQuery(
      `
      INSERT INTO resource_alert_deliveries (created_at, updated_at, incident_key, container_name,
        resource, observed_at, payload, next_attempt_at, receipts, status, attempts, lease_until, lease_owner, last_outcome)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', 'pending', 0, 0, '', 'queued') ON CONFLICT(incident_key) DO NOTHING`,
      [
        now,
        now,
        incidentKey,
        payload.containerName,
        resource,
        now,
        JSON.stringify(payload),
        now
      ]
    )
    // A recovered resource can become high again while an old delivery lease
    // is outstanding. Never resume that old observation as the new incident.
    await sails.getDatastore('observability').sendNativeQuery(
      `UPDATE resource_alert_deliveries SET status='recovered', last_outcome='superseded-by-new-incident',
        lease_until=0, lease_owner='' WHERE container_name=? AND resource=? AND status='pending' AND observed_at<? AND incident_key<>?`,
      [payload.containerName, resource, now, incidentKey]
    )
    return { incidentKey }
  }
}
