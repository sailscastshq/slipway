const fs = require('node:fs')
const MAX_BYTES = 2 * 1024 * 1024
module.exports = function probe(kind, values = {}) {
  const filename = process.env.QUEST_NATIVE_EVIDENCE
  if (!filename) throw new Error('A private native evidence file is required')
  const line =
    JSON.stringify({ kind, at: Date.now(), pid: process.pid, ...values }) + '\n'
  if (fs.statSync(filename).size + Buffer.byteLength(line) > MAX_BYTES)
    throw new Error('Native evidence exceeds 2 MiB')
  fs.appendFileSync(filename, line, { mode: 0o600 })
}
