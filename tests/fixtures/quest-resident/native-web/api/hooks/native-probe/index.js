const assert = require('node:assert/strict')
const path = require('node:path')
const probe = require('../../../lib/probe')
module.exports = (sails) => ({
  initialize(done) {
    const cli =
      /^sails(?:\.js)?$/.test(path.basename(process.argv[1] || '')) &&
      process.argv[2] === 'run'
    sails.after('hook:orm:loaded', () =>
      queueMicrotask(() => {
        assert.equal(sails.config.quest.autoStart, false)
        assert.equal(sails.config.models.migrate, 'safe')
        probe('sails-load', {
          cli,
          autoStart: sails.config.quest.autoStart,
          migrate: sails.config.models.migrate
        })
      })
    )
    for (const kind of ['start', 'complete', 'error', 'skip'])
      sails.on(`quest:job:${kind}`, (event) =>
        probe(`quest:${kind}`, {
          name: event.name,
          runId: event.runId,
          runtimeId: event.runtimeId,
          sequence: event.sequence,
          trigger: event.trigger,
          exitCode: event.exitCode,
          signal: event.signal
        })
      )
    done()
  }
})
