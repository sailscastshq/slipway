const { test } = require('sounding')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const mail = require('../../../../api/lib/bearing-update-mail')
const { drain } = require('../../../../api/lib/bearing-mail-queue')

test(
  'update delivery is default off, frozen, deduplicated and rechecks consent before retry',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'bearing-email-queue' } }
    }
  },
  async ({ sails, world }) => {
    const current = world.current
    const app = current.apps.web
    const environment = current.environments.production
    const project = current.projects.deploymentTarget
    await App.updateOne({ id: app.id }).set({ bearingEnabled: true })
    await Environment.updateOne({ id: environment.id }).set({
      domain: 'synthetic.example.test'
    })
    environment.domain = 'synthetic.example.test'
    const space = await BearingSpace.create({
      publicSlug: 'bearing-email-queue',
      app: app.id,
      createdBy: current.users.genesisUser.id
    }).fetch()
    const participant = await BearingParticipant.create({
      participantKey: 'synthetic-fixture',
      hostUserId: 'synthetic-customer',
      email: 'synthetic@example.test',
      emailVerifiedAt: Date.now(),
      firstSeenAt: Date.now(),
      lastSeenAt: Date.now(),
      space: space.id
    }).fetch()
    assert.equal(await mail.preference(participant), false)
    const consent = await BearingUpdateConsent.create({
      participant: participant.id,
      space: space.id,
      state: 'on',
      emailHash: mail.emailHash('synthetic@example.test')
    }).fetch()
    const publish = async (name) => {
      let update
      await sails.getDatastore().transaction(async (db) => {
        update = await BearingUpdate.create({
          title: name,
          slug: name,
          excerpt: 'Synthetic summary',
          body: '# Complete body\n\nA **full update**, with [documentation](/docs).\n\n- First improvement\n- Second improvement\n\n![Dashboard detail](/images/dashboard.png)\n\n```js\nconst complete = true\n```\n\n<iframe src="https://video.example.test/watch"></iframe>\n\nThe final authored line.',
          status: 'published',
          publishedAt: Date.now(),
          author: current.users.genesisUser.id,
          app: app.id,
          space: space.id
        })
          .fetch()
          .usingConnection(db)
        await mail.recordPublication(update, { app, environment, project }, db)
      })
      return update
    }
    const update = await publish('first-update')
    await BearingUpdate.updateOne({ id: update.id }).set({
      body: 'An edit that must not replace the frozen publication.'
    })
    const sent = []
    const original = sails.helpers.mail.sendConfigured
    let fail = false
    sails.helpers.mail.sendConfigured = {
      with: async (message) => {
        if (fail) throw new Error('synthetic SMTP failure')
        sent.push(message)
      }
    }
    try {
      await Promise.all([drain(), drain()])
      assert.equal(sent.length, 1)
      assert.equal(sent[0].to, 'synthetic@example.test')
      assert.match(sent[0].templateData.htmlContent, /The final authored line/)
      assert.doesNotMatch(sent[0].templateData.htmlContent, /An edit/)
      assert.match(sent[0].text, /The final authored line/)
      assert.equal(sent[0].rejectLoggingTransport, true)
      const evidence = path.resolve('.tmp/screenshots/issue-753')
      fs.mkdirSync(evidence, { recursive: true })
      fs.writeFileSync(
        path.join(evidence, 'synthetic-email.html'),
        sent[0].templateData.htmlContent
      )
      fs.writeFileSync(path.join(evidence, 'synthetic-email.txt'), sent[0].text)
      await drain()
      assert.equal(sent.length, 1)

      await publish('recovered-update')
      const event = await BearingUpdatePublication.findOne({ state: 'pending' })
      await BearingUpdatePublication.updateOne({ id: event.id }).set({
        state: 'expanding',
        leaseToken: 'dead-worker',
        leaseUntil: 1
      })
      await drain()
      assert.equal(sent.length, 2)
      const delivered = await BearingUpdateDelivery.findOne({
        publication: event.id
      })
      await BearingUpdateDelivery.updateOne({ id: delivered.id }).set({
        state: 'sending',
        leaseToken: 'dead-worker',
        leaseUntil: 1
      })
      await drain()
      // An SMTP-accepted but unrecorded delivery is retried after lease expiry.
      assert.equal(sent.length, 3)
      sent.splice(1)

      fail = true
      await publish('retry-update')
      await drain()
      const pending = await BearingUpdateDelivery.findOne({ state: 'pending' })
      assert.equal(pending.attempts, 1)
      await BearingUpdateConsent.create({
        participant: participant.id,
        space: space.id,
        state: 'off',
        emailHash: consent.emailHash
      })
      await BearingUpdateConsent.create({
        participant: participant.id,
        space: space.id,
        state: 'on',
        emailHash: consent.emailHash
      })
      fail = false
      await drain({ now: Date.now() + 3600000 })
      assert.equal(sent.length, 1)
      assert.equal(
        (await BearingUpdateDelivery.findOne({ id: pending.id })).state,
        'cancelled'
      )

      const freshUpdate = await publish('changed-email-update')
      await BearingParticipant.updateOne({ id: participant.id }).set({
        email: 'changed@example.test'
      })
      await drain()
      assert.equal(sent.length, 1)
      assert.equal(await mail.preference(participant), false)
      await BearingParticipant.updateOne({ id: participant.id }).set({
        email: 'synthetic@example.test'
      })
      await BearingSpace.updateOne({ id: space.id }).set({
        showPublicUpdates: false
      })
      await publish('hidden-update')
      await drain()
      assert.equal(sent.length, 1)
      assert.equal(
        await BearingUpdatePublication.count({ bearingUpdate: freshUpdate.id }),
        1
      )
    } finally {
      sails.helpers.mail.sendConfigured = original
    }
  }
)
