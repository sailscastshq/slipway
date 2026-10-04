const { test } = require('sounding')
const assert = require('node:assert/strict')
const {
  advanceResourceAlertState
} = require('../../../../api/lib/resource-alert-state')
const {
  deliveryKey,
  resourceAlertMessage
} = require('../../../../api/lib/resource-alert-message')
function replace(object, key, value) {
  Object.defineProperty(object, key, {
    value,
    configurable: true,
    writable: true
  })
}
async function fixture(sails, body) {
  const containerName = 'alert-delivery-fixture'
  await sails.models.resourcealertdelivery.destroy({ containerName })
  await sails.models.resourcealertstate.destroy({ containerName })
  const originalGet = sails.helpers.setting.get
  const originalMail = sails.helpers.mail.sendConfigured
  const settings = {
    smtpEnabled: 'true',
    notificationEmails: 'one@example.com, ONE@example.com, two@example.com',
    notifyOnHighResourceUsage: 'true'
  }
  const messages = []
  let fail = 'two@example.com'
  replace(
    sails.helpers.setting,
    'get',
    async (key, fallback) => settings[key] ?? fallback
  )
  replace(sails.helpers.mail, 'sendConfigured', {
    with: async (message) => {
      messages.push(message)
      if (message.to === fail) throw new Error('fixture SMTP denial')
    }
  })
  const now = Date.now()
  const payload = {
    containerName,
    cpuPercent: 0.01,
    memoryPercent: 90.6,
    memoryUsage: 464 * 1048576,
    memoryLimit: 512 * 1048576,
    cpuHigh: false,
    memHigh: true,
    observedAt: now,
    targetLabel: 'sailsconf/production',
    lookoutUrl: 'https://fixture.invalid/lookout'
  }
  const state = await sails.models.resourcealertstate
    .create({ containerName, memoryActive: true, lastSampleAt: now })
    .fetch()
  try {
    await sails.helpers.lookout.queueResourceAlert.with({
      payload,
      previousSampleAt: now - 30000
    })
    await body({
      now,
      payload,
      settings,
      messages,
      state,
      model: sails.models.resourcealertdelivery,
      states: sails.models.resourcealertstate,
      setFail: (value) => {
        fail = value
      },
      drain: (at) =>
        sails.helpers.lookout.deliverResourceAlerts.with({ now: at }),
      row: () => sails.models.resourcealertdelivery.findOne({ containerName })
    })
  } finally {
    replace(sails.helpers.setting, 'get', originalGet)
    replace(sails.helpers.mail, 'sendConfigured', originalMail)
    await sails.models.resourcealertdelivery.destroy({ containerName })
    await sails.models.resourcealertstate.destroy({ containerName })
  }
}

test('durable partial delivery deduplicates recipients and skips acknowledged recipients after restart', async ({
  sails
}) => {
  await fixture(sails, async (f) => {
    await f.drain(f.now)
    let row = await f.row()
    assert.equal(row.status, 'pending')
    assert.equal(row.lastOutcome, 'failed')
    assert.equal(row.attempts, 1)
    assert.equal(row.nextAttemptAt, f.now + 60000)
    assert.deepEqual(
      f.messages.map((x) => x.to),
      ['one@example.com', 'two@example.com']
    )
    assert.ok(row.receipts[deliveryKey('email', 'one@example.com')])
    assert.ok(!JSON.stringify(row.receipts).includes('example.com'))
    assert.equal(f.messages[0].waitForAcknowledgement, true)
    assert.match(f.messages[0].subject, /memory above 90%.*464 MiB of 512 MiB/)
    assert.match(
      f.messages[0].headers['Message-ID'],
      /^<[a-f0-9]+@slipway.local>$/
    )
    await f.drain(f.now + 59000)
    assert.equal(f.messages.length, 2)
    // New invocation reloads persisted state, as a restarted control plane does.
    f.setFail('')
    await f.drain(f.now + 60000)
    row = await f.row()
    assert.equal(row.status, 'sent')
    assert.deepEqual(
      f.messages.map((x) => x.to),
      ['one@example.com', 'two@example.com', 'two@example.com']
    )
    await f.drain(f.now + 90000)
    assert.equal(f.messages.length, 3)
  })
})
test('a failing first batch cannot starve later email recipients', async ({
  sails
}) => {
  await fixture(sails, async (f) => {
    f.settings.notificationEmails =
      'a@example.com,b@example.com,c@example.com,d@example.com'
    replace(sails.helpers.mail, 'sendConfigured', {
      with: async (message) => {
        f.messages.push(message)
        if (message.to !== 'd@example.com')
          throw new Error('fixture permanent denial')
      }
    })
    await f.drain(f.now)
    assert.equal(f.messages.length, 3)
    await f.drain(f.now + 60000)
    assert.ok((await f.row()).receipts[deliveryKey('email', 'd@example.com')])
  })
})

test('disabled and re-enabled notifications preserve pending incidents without spending retries', async ({
  sails
}) => {
  await fixture(sails, async (f) => {
    f.settings.notifyOnHighResourceUsage = 'false'
    await f.drain(f.now)
    let row = await f.row()
    assert.equal(row.lastOutcome, 'disabled')
    assert.equal(row.attempts, 0)
    assert.equal(f.messages.length, 0)
    f.settings.notifyOnHighResourceUsage = 'true'
    f.setFail('')
    await f.states
      .updateOne({ id: f.state.id })
      .set({ lastSampleAt: f.now + 300000 })
    await f.drain(f.now + 300000)
    assert.equal((await f.row()).status, 'sent')
    assert.equal(f.messages.length, 2)
  })
})

test('disabled SMTP and missing recipients wait until configuration is restored', async ({
  sails
}) => {
  await fixture(sails, async (f) => {
    f.settings.smtpEnabled = 'false'
    await f.drain(f.now)
    assert.equal((await f.row()).status, 'pending')
    assert.equal(f.messages.length, 0)
    f.settings.smtpEnabled = 'true'
    f.settings.notificationEmails = ''
    await f.states
      .updateOne({ id: f.state.id })
      .set({ lastSampleAt: f.now + 300000 })
    await f.drain(f.now + 300000)
    assert.equal((await f.row()).lastOutcome, 'unconfigured')
    assert.equal((await f.row()).attempts, 0)
    f.settings.notificationEmails = 'one@example.com'
    await f.states
      .updateOne({ id: f.state.id })
      .set({ lastSampleAt: f.now + 600000 })
    await f.drain(f.now + 600000)
    assert.equal((await f.row()).status, 'sent')
  })
})

test('fresh recovery cancels unsent warnings; sampling gaps hold rather than falsely recover', async ({
  sails
}) => {
  await fixture(sails, async (f) => {
    await f.drain(f.now + 180000)
    assert.equal((await f.row()).lastOutcome, 'waiting-for-fresh-sample')
    assert.equal(f.messages.length, 0)
    await f.states
      .updateOne({ id: f.state.id })
      .set({ memoryActive: false, lastSampleAt: f.now + 240000 })
    await f.drain(f.now + 240000)
    assert.equal((await f.row()).status, 'recovered')
    assert.equal(f.messages.length, 0)
  })
})

test('atomic leases survive restart and expired leases resume without losing receipts', async ({
  sails
}) => {
  await fixture(sails, async (f) => {
    const row = await f.row()
    await f.model.updateOne({ id: row.id }).set({
      leaseOwner: 'dead-worker',
      leaseUntil: f.now + 900000,
      receipts: { [deliveryKey('email', 'one@example.com')]: f.now }
    })
    assert.equal((await f.drain(f.now)).claimed, 0)
    f.setFail('')
    await f.states
      .updateOne({ id: f.state.id })
      .set({ lastSampleAt: f.now + 900000 })
    const results = await Promise.all([
      f.drain(f.now + 900000),
      f.drain(f.now + 900000)
    ])
    assert.equal(
      results.reduce((n, r) => n + r.claimed, 0),
      1
    )
    assert.deepEqual(
      f.messages.map((x) => x.to),
      ['two@example.com']
    )
    assert.equal((await f.row()).status, 'sent')
  })
})

test('queue keys survive a crash before detection-state persistence; retry backoff is capped', async ({
  sails
}) => {
  await fixture(sails, async (f) => {
    await sails.helpers.lookout.queueResourceAlert.with({
      payload: { ...f.payload, observedAt: f.now + 30000 },
      previousSampleAt: f.now - 30000
    })
    assert.equal(
      await f.model.count({ containerName: f.payload.containerName }),
      1
    )
    const row = await f.row()
    await f.model.updateOne({ id: row.id }).set({ attempts: 20 })
    await f.drain(f.now)
    assert.equal((await f.row()).nextAttemptAt, f.now + 1800000)
  })
})

test('seven-day stale incidents expire visibly instead of sending obsolete warnings', async ({
  sails
}) => {
  await fixture(sails, async (f) => {
    await f.drain(f.now + 8 * 86400000)
    assert.equal((await f.row()).status, 'expired')
    assert.equal((await f.row()).lastOutcome, 'expired-after-seven-days')
    assert.equal(f.messages.length, 0)
  })
})

test('invalid measurements never advance detection or recovery and CPU wording states its actual denominator', () => {
  const previous = {
    memoryActive: true,
    lastSampleAt: 100,
    memoryRecoverySamples: 2
  }
  for (const invalid of [NaN, Infinity, -1, 101]) {
    const result = advanceResourceAlertState(
      previous,
      { cpuPercent: 1, memPercent: invalid },
      130
    )
    assert.equal(result.skipped, true)
    assert.deepEqual(result.state, previous)
  }
  const message = resourceAlertMessage({
    cpuHigh: true,
    memHigh: false,
    cpuPercent: 101.14,
    memoryPercent: 10,
    memoryUsage: 512,
    memoryLimit: 1024,
    observedAt: 1000,
    containerName: 'fixture'
  })
  assert.match(message.subject, /cpu above 90%.*101.1% of one CPU core/)
  assert.match(message.basis, /not percent of the configured CPU quota/)
  assert.equal(message.observedAtText, '1970-01-01 00:00:01 UTC')
})

test('late mail acknowledgements persist during an uncertain-send lease and prevent retries', async ({
  sails
}) => {
  await fixture(sails, async (f) => {
    const fs = require('node:fs')
    const vm = require('node:vm')
    const path = require('node:path')
    const helperPath = path.resolve(
      'api/helpers/notification/send-resource-alert.js'
    )
    const context = {
      module: { exports: {} },
      require: require('node:module').createRequire(helperPath),
      sails,
      setTimeout: (callback) => {
        queueMicrotask(callback)
        return 1
      },
      clearTimeout() {},
      AbortSignal
    }
    vm.runInNewContext(fs.readFileSync(helperPath, 'utf8'), context)
    let acknowledge
    const originalSender = sails.helpers.notification.sendResourceAlert
    f.settings.notificationEmails = 'one@example.com'
    replace(sails.helpers.mail, 'sendConfigured', {
      with: (message) => {
        f.messages.push(message)
        return new Promise((resolve) => {
          acknowledge = resolve
        })
      }
    })
    replace(sails.helpers.notification, 'sendResourceAlert', {
      with: (inputs) => context.module.exports.fn(inputs)
    })
    try {
      await f.drain(f.now)
      let row = await f.row()
      assert.equal(row.lastOutcome, 'unconfirmed')
      assert.equal(row.leaseUntil, f.now + 900000)
      assert.equal((await f.drain(f.now + 60000)).claimed, 0)
      acknowledge()
      for (let i = 0; i < 20; i++) {
        row = await f.row()
        if (Object.keys(row.receipts).length) break
        await new Promise((resolve) => setImmediate(resolve))
      }
      assert.equal(Object.keys(row.receipts).length, 1)
      await f.states
        .updateOne({ id: f.state.id })
        .set({ lastSampleAt: f.now + 900000 })
      await f.drain(f.now + 900000)
      assert.equal((await f.row()).status, 'sent')
      assert.equal(f.messages.length, 1)
    } finally {
      replace(sails.helpers.notification, 'sendResourceAlert', originalSender)
    }
  })
})

test('a configured disabled channel waits while successful channels are not resent', async ({
  sails
}) => {
  await fixture(sails, async (f) => {
    const original = sails.helpers.notification.sendSlack
    const slack = []
    f.settings.slackEnabled = 'true'
    f.settings.slackWebhookUrl = 'https://fixture.invalid/slack'
    f.settings.smtpEnabled = 'false'
    replace(sails.helpers.notification, 'sendSlack', {
      with: async (message) => {
        slack.push(message)
      }
    })
    try {
      await f.drain(f.now)
      assert.equal(slack.length, 1)
      assert.equal((await f.row()).status, 'pending')
      f.settings.smtpEnabled = 'true'
      f.setFail('')
      await f.states
        .updateOne({ id: f.state.id })
        .set({ lastSampleAt: f.now + 300000 })
      await f.drain(f.now + 300000)
      assert.equal((await f.row()).status, 'sent')
      assert.equal(slack.length, 1)
      assert.equal(f.messages.length, 2)
    } finally {
      replace(sails.helpers.notification, 'sendSlack', original)
    }
  })
})

test('delivery attempts are bounded to three destinations per incident invocation', async ({
  sails
}) => {
  await fixture(sails, async (f) => {
    f.settings.notificationEmails =
      'a@example.com,b@example.com,c@example.com,d@example.com'
    f.setFail('')
    await f.drain(f.now)
    assert.equal(f.messages.length, 3)
    assert.equal((await f.row()).lastOutcome, 'remaining')
    await f.drain(f.now + 60000)
    assert.equal(f.messages.length, 4)
    assert.equal((await f.row()).status, 'sent')
  })
})

test('a new high episode supersedes an old undelivered incident after recovery', async ({
  sails
}) => {
  await fixture(sails, async (f) => {
    const old = await f.row()
    await f.model.updateOne({ id: old.id }).set({
      leaseUntil: f.now + 900000,
      leaseOwner: 'expired-process'
    })
    await sails.helpers.lookout.queueResourceAlert.with({
      payload: { ...f.payload, observedAt: f.now + 300000 },
      previousSampleAt: f.now + 270000
    })
    const previous = await f.model.findOne({ id: old.id })
    assert.equal(previous.status, 'recovered')
    assert.equal(previous.lastOutcome, 'superseded-by-new-incident')
    assert.equal(previous.leaseOwner, '')
    await f.states.updateOne({ id: f.state.id }).set({
      lastSampleAt: f.now + 300000
    })
    f.setFail('')
    await f.drain(f.now + 300000)
    assert.equal(f.messages.length, 2)
    assert.equal((await f.model.findOne({ id: old.id })).status, 'recovered')
  })
})

test('retention keeps the latest active-incident receipt and removes it after recovery', async ({
  sails
}) => {
  await fixture(sails, async (f) => {
    const row = await f.row()
    await f.model
      .updateOne({ id: row.id })
      .set({ observedAt: f.now - 8 * 86400000, status: 'sent' })
    const prune = () =>
      sails.helpers.lookout.pruneObservability.with({
        now: f.now,
        containerRetentionMs: 86400000,
        telemetryRetentionMs: 7 * 86400000,
        batchSize: 100,
        maxBatches: 2
      })
    await prune()
    assert.ok(await f.row())
    await f.states.updateOne({ id: f.state.id }).set({ memoryActive: false })
    await prune()
    assert.equal(await f.row(), undefined)
  })
})

test('each dispatcher cycle claims at most five incidents', async ({
  sails
}) => {
  await fixture(sails, async (f) => {
    const names = Array.from(
      { length: 5 },
      (_, i) => 'alert-delivery-batch-' + i
    )
    f.settings.notificationEmails = 'one@example.com'
    f.setFail('')
    try {
      for (const containerName of names) {
        await f.states.create({
          containerName,
          memoryActive: true,
          lastSampleAt: f.now
        })
        await sails.helpers.lookout.queueResourceAlert.with({
          previousSampleAt: f.now - 30000,
          payload: { ...f.payload, containerName }
        })
      }
      assert.equal((await f.drain(f.now)).claimed, 5)
      assert.equal(f.messages.length, 5)
      assert.equal((await f.drain(f.now)).claimed, 1)
      assert.equal(f.messages.length, 6)
    } finally {
      await f.model.destroy({ containerName: names })
      await f.states.destroy({ containerName: names })
    }
  })
})
