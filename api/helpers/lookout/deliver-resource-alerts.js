const { randomUUID } = require('node:crypto')
const LEASE_MS = 15 * 60 * 1000
const FRESH_MS = 2 * 60 * 1000
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000
module.exports = {
  friendlyName: 'Deliver resource alerts',
  description:
    'Drain a small due batch independently of the Docker collector, preserving destination receipts.',
  inputs: { now: { type: 'number', defaultsTo: 0 } },
  fn: async function ({ now }) {
    const clock = now ? () => now : Date.now
    now = clock()
    const rows = await ResourceAlertDelivery.find({
      status: 'pending',
      nextAttemptAt: { '<=': now },
      leaseUntil: { '<=': now }
    })
      .sort('nextAttemptAt ASC')
      .limit(5)
    const counts = { claimed: 0, sent: 0, waiting: 0, recovered: 0, expired: 0 }
    for (const row of rows) {
      now = clock()
      const owner = randomUUID()
      await sails.getDatastore('observability').sendNativeQuery(
        `UPDATE resource_alert_deliveries
        SET lease_owner=?, lease_until=? WHERE id=? AND status='pending' AND lease_until<=? AND next_attempt_at<=?`,
        [owner, now + LEASE_MS, row.id, now, now]
      )
      // The adapter does not expose UPDATE RETURNING rows. Verify the unique
      // ownership nonce after the atomic conditional update instead.
      if (
        !(await ResourceAlertDelivery.findOne({
          id: row.id,
          leaseOwner: owner
        }))
      )
        continue
      counts.claimed++
      const update = (values) =>
        ResourceAlertDelivery.updateOne({ id: row.id, leaseOwner: owner }).set(
          values
        )
      try {
        const state = await ResourceAlertState.findOne({
          containerName: row.containerName
        })
        const fresh =
          state &&
          state.lastSampleAt >= row.observedAt &&
          now - state.lastSampleAt <= FRESH_MS
        if (fresh && !state[`${row.resource}Active`]) {
          await update({
            status: 'recovered',
            lastOutcome: 'recovered-before-delivery',
            leaseUntil: 0,
            leaseOwner: ''
          })
          counts.recovered++
          continue
        }
        if (now - row.observedAt > RETENTION_MS) {
          await update({
            status: 'expired',
            lastOutcome: 'expired-after-seven-days',
            leaseUntil: 0,
            leaseOwner: ''
          })
          sails.log.warn(
            'Lookout: Undelivered resource incident expired; inspect delivery state'
          )
          counts.expired++
          continue
        }
        if (!fresh) {
          await update({
            lastOutcome: 'waiting-for-fresh-sample',
            nextAttemptAt: now + 60000,
            leaseUntil: 0,
            leaseOwner: ''
          })
          counts.waiting++
          continue
        }
        const receipts = { ...row.receipts }
        const outcome = await sails.helpers.notification.sendResourceAlert.with(
          {
            ...row.payload,
            incidentKey: row.incidentKey,
            receipts,
            deliveryAttempt: row.attempts,
            onDelivered: async (key) => {
              receipts[key] = clock()
              if (!(await update({ receipts: { ...receipts } })))
                throw new Error('DELIVERY_LEASE_LOST')
            }
          }
        )
        const attempts = row.attempts + (outcome.attempted ? 1 : 0)
        now = clock()
        const delay =
          outcome.outcome === 'unconfirmed'
            ? LEASE_MS
            : outcome.attempted
            ? Math.min(30 * 60000, 60000 * 2 ** Math.min(attempts - 1, 5))
            : 5 * 60000
        await update({
          status: outcome.outcome === 'sent' ? 'sent' : 'pending',
          lastOutcome: outcome.outcome,
          attempts,
          nextAttemptAt: now + delay,
          // Hold the same lease for late SMTP acknowledgement after a deadline.
          leaseUntil: outcome.outcome === 'unconfirmed' ? now + LEASE_MS : 0,
          leaseOwner: outcome.outcome === 'unconfirmed' ? owner : ''
        })
        if (outcome.outcome === 'sent') counts.sent++
        else counts.waiting++
      } catch {
        await update({
          lastOutcome: 'dispatcher-failed',
          nextAttemptAt: now + 60000,
          leaseUntil: 0,
          leaseOwner: ''
        })
        sails.log.warn(
          'Lookout: Resource alert dispatcher failed; durable retry retained'
        )
      }
    }
    return counts
  }
}
