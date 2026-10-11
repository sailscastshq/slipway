const crypto = require('node:crypto')
const mail = require('./bearing-update-mail')
const LEASE_MS = 5 * 60 * 1000
async function claim(model, item, state, now) {
  const leaseToken = crypto.randomUUID()
  return model
    .updateOne({ id: item.id, state: item.state, leaseUntil: item.leaseUntil })
    .set({ state, leaseToken, leaseUntil: now + LEASE_MS })
}
async function drain({ now = Date.now(), batchSize = 10 } = {}) {
  batchSize = Math.max(1, Math.min(50, batchSize))
  const events = await BearingUpdatePublication.find({
    or: [{ state: 'pending' }, { state: 'expanding', leaseUntil: { '<': now } }]
  })
    .sort('id ASC')
    .limit(2)
  for (const event of events) {
    const owned = await claim(BearingUpdatePublication, event, 'expanding', now)
    if (!owned) continue
    const consents = await BearingUpdateConsent.find({
      space: owned.space,
      id: { '>': owned.cursor, '<=': owned.consentWatermark },
      state: 'on'
    })
      .sort('id ASC')
      .limit(50)
    for (const consent of consents) {
      const current = await mail.latest(consent.participant)
      if (current?.id !== consent.id) continue
      const deliveryKey = `update:${owned.bearingUpdate}:participant:${consent.participant}`
      try {
        await BearingUpdateDelivery.create({
          deliveryKey,
          publication: owned.id,
          participant: consent.participant,
          consent: consent.id
        })
      } catch (error) {
        if (error.code !== 'E_UNIQUE') throw error
      }
    }
    await BearingUpdatePublication.updateOne({
      id: owned.id,
      leaseToken: owned.leaseToken
    }).set({
      cursor: consents.at(-1)?.id || owned.cursor,
      state: consents.length === 50 ? 'pending' : 'complete',
      leaseToken: null,
      leaseUntil: 0
    })
  }
  const deliveries = await BearingUpdateDelivery.find({
    or: [
      { state: 'pending', nextAttemptAt: { '<=': now } },
      { state: 'sending', leaseUntil: { '<': now } }
    ]
  })
    .sort('id ASC')
    .limit(batchSize)
  for (const item of deliveries) {
    const owned = await claim(BearingUpdateDelivery, item, 'sending', now)
    if (!owned) continue
    const current = await mail.latest(owned.participant)
    const participant = await BearingParticipant.findOne({
      id: owned.participant
    }).decrypt()
    const publication = await BearingUpdatePublication.findOne({
      id: owned.publication
    })
    const space = publication
      ? await BearingSpace.findOne({ id: publication.space })
      : null
    const app = space ? await App.findOne({ id: space.app }) : null
    const update = publication
      ? await BearingUpdate.findOne({
          id: publication.bearingUpdate,
          status: 'published',
          space: publication.space
        })
      : null
    if (
      !current ||
      current.id !== owned.consent ||
      current.state !== 'on' ||
      !participant ||
      participant.disabledAt ||
      !participant.emailVerifiedAt ||
      current.emailHash !== mail.emailHash(participant.email) ||
      !space?.showPublicUpdates ||
      !app?.bearingEnabled ||
      !update ||
      !publication.snapshot.publicUrl
    ) {
      await BearingUpdateDelivery.updateOne({
        id: owned.id,
        leaseToken: owned.leaseToken
      }).set({ state: 'cancelled', leaseToken: null, leaseUntil: 0 })
      continue
    }
    const snapshot = publication.snapshot
    const rendered = mail.render(snapshot.body, snapshot.publicUrl)
    const base = snapshot.publicUrl.split('/bearing/updates/')[0]
    const unsubscribe = `${base}/bearing/unsubscribe?token=${encodeURIComponent(
      mail.token(current, sails.config.session.secret)
    )}`
    const preferences = `${base}/bearing/updates`
    const date = new Date(snapshot.publishedAt).toISOString().slice(0, 10)
    const clipping =
      Buffer.byteLength(rendered.html) > 100 * 1024
        ? '<p style="font-size:12px">Some email clients may clip this long update. The full update is included below and available in your browser.</p>'
        : ''
    const htmlContent = `<!doctype html><html><body style="margin:0;background:#ffffff;color:#18181b"><div style="max-width:640px;margin:0 auto;padding:24px;font-family:Arial,sans-serif;overflow-wrap:anywhere"><a href="${mail.escape(
      snapshot.publicUrl
    )}" style="font-size:12px">View in browser</a><p>${mail.escape(
      snapshot.appName
    )}</p><h1>${mail.escape(
      snapshot.title
    )}</h1><p style="color:#71717a;font-size:12px">${date}</p>${clipping}${
      rendered.html
    }<hr /><p style="font-size:12px"><a href="${mail.escape(
      preferences
    )}">Email preferences</a> · <a href="${mail.escape(
      unsubscribe
    )}">Unsubscribe</a></p></div></body></html>`
    const text = `View in browser: ${snapshot.publicUrl}\n\n${snapshot.appName}\n${snapshot.title}\n${date}\n\n${rendered.text}\nEmail preferences: ${preferences}\nUnsubscribe: ${unsubscribe}`
    try {
      await sails.helpers.mail.sendConfigured.with({
        to: participant.email,
        toName: participant.displayName || undefined,
        subject: `${snapshot.appName}: ${snapshot.title}`,
        template: 'bearing-update',
        templateData: { htmlContent },
        text,
        layout: false,
        rejectLoggingTransport: true,
        waitForAcknowledgement: true
      })
      await BearingUpdateDelivery.updateOne({
        id: owned.id,
        leaseToken: owned.leaseToken
      }).set({
        state: 'sent',
        attempts: owned.attempts + 1,
        leaseToken: null,
        leaseUntil: 0
      })
    } catch {
      const attempts = owned.attempts + 1
      await BearingUpdateDelivery.updateOne({
        id: owned.id,
        leaseToken: owned.leaseToken
      }).set({
        state: attempts >= 5 ? 'failed' : 'pending',
        attempts,
        nextAttemptAt: now + Math.min(60 * 60 * 1000, 30000 * 2 ** attempts),
        leaseToken: null,
        leaseUntil: 0
      })
    }
  }
}
module.exports = { drain }
