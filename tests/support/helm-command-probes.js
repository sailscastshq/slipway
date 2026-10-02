// Serialized into a disposable container by the command contract. Keeping the
// probes as functions avoids nested source-string/regex escaping mistakes.
function spawnDescendant() {
  const child = require('node:child_process').spawn(
    process.execPath,
    ['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],
    { stdio: 'ignore' }
  )
  process.on('SIGTERM', () => {})
  console.log(child.pid)
  setInterval(() => {}, 1000)
}

function assertStopped(pid) {
  try {
    const stat = require('node:fs').readFileSync(`/proc/${pid}/stat`, 'utf8')
    const state = stat
      .slice(stat.lastIndexOf(')') + 1)
      .trim()
      .split(/\s+/)[0]
    if (!['Z', 'X'].includes(state)) process.exit(1)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

function assertNoOwnedProcesses(executionId) {
  const fs = require('node:fs')
  for (const pid of fs
    .readdirSync('/proc')
    .filter((pid) => /^\d+$/.test(pid))) {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8')
      const state = stat
        .slice(stat.lastIndexOf(')') + 1)
        .trim()
        .split(/\s+/)[0]
      if (['Z', 'X'].includes(state)) continue
      const environment = fs.readFileSync(`/proc/${pid}/environ`, 'utf8')
      if (
        environment
          .split('\0')
          .includes(`SLIPWAY_HELM_EXECUTION_ID=${executionId}`)
      )
        process.exit(1)
    } catch (error) {
      if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error
    }
  }
}

module.exports = { spawnDescendant, assertStopped, assertNoOwnedProcesses }
