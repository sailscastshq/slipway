const fs = require('node:fs')
const path = require('node:path')
const probe = require('../../../lib/probe')

module.exports = (sails) => ({
  initialize(done) {
    const isScript =
      /^sails(?:\.js)?$/.test(path.basename(process.argv[1] || '')) &&
      process.argv[2] === 'run'
    // Upstream applies its process-local child policy in its ORM-ready listener.
    // Observe after all synchronous listeners. Do not "repair" an unsafe hook.
    sails.after('hook:orm:loaded', () =>
      queueMicrotask(() => {
        if (isScript && sails.config.quest.autoStart !== false) {
          console.error(
            'Unsafe upstream child bootstrap: effective Quest autoStart must be false'
          )
          process.exit(78)
        }
        probe('sails-load', {
          autoStart: sails.config.quest.autoStart,
          migrate: sails.config.models.migrate,
          argv: process.argv.slice(1)
        })
      })
    )
    for (const event of ['start', 'complete', 'error', 'skip']) {
      sails.on(`quest:job:${event}`, (data) =>
        probe(`quest:${event}`, {
          name: data.name,
          runId: data.runId,
          runtimeId: data.runtimeId,
          sequence: data.sequence,
          trigger: data.trigger,
          exitCode: data.exitCode,
          signal: data.signal,
          admission: data.admission,
          phase: data.phase,
          reason: data.reason,
          inputs: data.inputs,
          result: data.result,
          childrenAtEvent: fs
            .readFileSync(`/proc/self/task/${process.pid}/children`, 'utf8')
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .map(Number)
        })
      )
    }
    done()
  }
})
