const assert = require('node:assert/strict')
const fs = require('node:fs')
const sails = require('sails')
const probe = require('./lib/probe')

sails.lift(sails.getRc(), async (error) => {
  try {
    if (error) throw error
    assert.equal(
      typeof sails.quest?.getRuntime,
      'function',
      'A compatible real upstream source is required; released Quest 0.0.5 is insufficient'
    )
    const info = sails.quest.getRuntime()
    assert.equal(info.contractVersion, 1)
    for (const capability of [
      'residentState',
      'runIdentity',
      'inputMetadata',
      'businessResults',
      'childSchedulerSuppression',
      'triggerProvenance',
      'terminalExitCode',
      'terminalSignal',
      'scheduleDiagnostics'
    ])
      assert.equal(
        info.capabilities?.[capability],
        true,
        `Missing upstream capability: ${capability}`
      )
    assert.equal(typeof sails.quest.metadata, 'function')
    assert.ok(
      sails.quest.metadata().every((job) => job.inputMetadataAvailable === true)
    )
    assert.equal(Boolean(sails.hooks.http), false, 'This is a worker-only app')
    // This source-owned real timer is registered; start the trial paused.
    // Later controls travel through Slipway's actual resident transport.
    sails.quest.pause('slow-overlap')
    sails.quest.pause('timezone-cron')
    sails.quest.pause('timezone-default')
    sails.quest.stop('stopped-schedule')
    let consumed = false
    process.on('SIGURG', () => {
      assert.equal(consumed, false, 'One finite one-shot registration only')
      consumed = true
      sails.quest.add({
        name: 'consumed-once',
        script: 'result-value',
        timeout: 200,
        inputs: { value: 'one-shot' }
      })
    })
    let pressured = false
    process.on('SIGWINCH', () => {
      assert.equal(
        pressured,
        false,
        'One bounded retention-pressure phase only'
      )
      pressured = true
      const name = 'retention-pressure'
      let skips = 0
      const observe = (event) => {
        if (event.name !== name || ++skips < 40) return
        // Stop after the scheduling callback has registered its next timer.
        queueMicrotask(() => {
          sails.quest.stop(name)
          sails.removeListener('quest:job:skip', observe)
          probe('pressure:complete', { runtimeId: info.runtimeId, skips })
        })
      }
      sails.on('quest:job:skip', observe)
      // Real upstream timer callbacks and pause checks create retention pressure
      // without launching children or fabricating events/receipts. This is a
      // deliberately dynamic fixture definition, so its schema stays unavailable.
      sails.quest.add({ name, script: 'result-value', interval: 100 })
      sails.quest.pause(name)
    })
    const filename = `/tmp/slipway-quest-runtimes/${process.env.SLIPWAY_APP_ID}-${process.env.SLIPWAY_DEPLOYMENT_ID}-${process.pid}.json`
    const deadline = Date.now() + 10000
    while (!fs.existsSync(filename)) {
      if (Date.now() >= deadline)
        throw new Error('Full Slipway hook did not auto-register the worker')
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    const identity = JSON.parse(fs.readFileSync(filename, 'utf8'))
    assert.equal(identity.runtimeId, info.runtimeId)
    fs.writeFileSync(
      '/tmp/quest-resident-ready.json',
      JSON.stringify({
        ...identity,
        http: false,
        capabilities: info.capabilities,
        upstreamVersion: require('sails-hook-quest/package.json').version
      })
    )
    console.log('[Quest fixture] Full worker hooks ready', info.runtimeId)
  } catch (failure) {
    console.error('[Quest fixture]', failure.stack || failure)
    process.exit(1)
  }
})
