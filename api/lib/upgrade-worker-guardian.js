const fs = require('node:fs')
let owned
let timer
function identity(pid) {
  const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8')
  return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]
}
function terminate() {
  if (owned) {
    try {
      // A reused numeric PID must not authorize killing another process group.
      if (identity(owned.pid) === owned.start)
        process.kill(-owned.pid, 'SIGKILL')
    } catch {
      // The supervisor also waits for native exit; absence is already stopped.
    }
  }
  process.exit(0)
}
process.on('message', (message) => {
  if (message.type === 'disarm') {
    clearTimeout(timer)
    owned = null
    process.exit(0)
  }
  if (owned || message.type !== 'arm') return process.exit(1)
  if (
    !Number.isSafeInteger(message.pid) ||
    message.pid <= 1 ||
    !Number.isSafeInteger(message.deadline)
  )
    return process.exit(1)
  try {
    if (identity(message.pid) !== message.start) return process.exit(1)
    owned = message
    process.send({ type: 'armed' })
    timer = setTimeout(terminate, Math.max(1, message.deadline - Date.now()))
  } catch {
    process.exit(1)
  }
})
// A controller crash must not leave an unbounded synchronous SQLite worker.
process.on('disconnect', terminate)
