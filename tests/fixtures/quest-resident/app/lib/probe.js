const fs = require('node:fs')

// Synthetic evidence only. This observes actual execution; it never supplies
// lifecycle events, executes a script, or replaces the resident scheduler.
module.exports = function probe(kind, values = {}) {
  fs.appendFileSync(
    '/tmp/quest-fixture-evidence.jsonl',
    JSON.stringify({
      kind,
      at: Date.now(),
      pid: process.pid,
      ...values
    }) + '\n'
  )
}
