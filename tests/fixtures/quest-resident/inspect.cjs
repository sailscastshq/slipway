const fs = require('node:fs')
const assert = require('node:assert/strict')
const {
  startTicks
} = require('/app/node_modules/sails-hook-slipway/lib/helm-runtime-contract')
const json = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const mode = process.argv[2]
let result
if (mode === 'ready') result = json('/tmp/quest-resident-ready.json')
else if (mode === 'evidence') {
  const file = '/tmp/quest-fixture-evidence.jsonl'
  assert.ok(fs.statSync(file).size <= 256 * 1024)
  result = fs
    .readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(JSON.parse)
} else if (mode === 'ownership') {
  const root = '/tmp/slipway-quest-runtimes',
    directory = fs.statSync(root),
    live = []
  for (const filename of fs
    .readdirSync(root)
    .filter((name) => name.endsWith('.json'))) {
    const identity = json(`${root}/${filename}`)
    let stat
    try {
      stat = fs.readFileSync(`/proc/${identity.pid}/stat`, 'utf8')
    } catch {
      continue
    }
    if (startTicks(stat) !== identity.startTicks) continue
    const file = fs.statSync(`${root}/${filename}`),
      socket = fs.statSync(identity.socket)
    const uid = Number(
      fs
        .readFileSync(`/proc/${identity.pid}/status`, 'utf8')
        .match(/^Uid:\s+(\d+)/m)[1]
    )
    live.push({
      identity,
      uid,
      directoryUid: directory.uid,
      directoryMode: directory.mode & 0o777,
      fileUid: file.uid,
      fileMode: file.mode & 0o777,
      socketUid: socket.uid,
      socketMode: socket.mode & 0o777,
      socket: socket.isSocket()
    })
  }
  const listeners = ['tcp', 'tcp6'].flatMap((family) =>
    fs
      .readFileSync(`/proc/net/${family}`, 'utf8')
      .trim()
      .split('\n')
      .slice(1)
      .filter((line) => line.trim().split(/\s+/)[3] === '0A')
  )
  result = { live, tcpListeners: listeners.length }
} else if (mode === 'pressure' || mode === 'consume') {
  const resident = json('/tmp/quest-resident-ready.json')
  assert.equal(
    startTicks(fs.readFileSync(`/proc/${resident.pid}/stat`, 'utf8')),
    resident.startTicks
  )
  assert.ok(
    fs
      .readFileSync(`/proc/${resident.pid}/cmdline`, 'utf8')
      .split('\0')
      .some((arg) => /(?:^|\/)app\.js$/.test(arg))
  )
  process.kill(resident.pid, mode === 'pressure' ? 'SIGWINCH' : 'SIGURG')
  result = { requested: mode }
} else if (mode === 'restart') {
  const supervisor = json('/tmp/quest-fixture-supervisor.json')
  assert.equal(
    startTicks(fs.readFileSync(`/proc/${supervisor.pid}/stat`, 'utf8')),
    supervisor.startTicks
  )
  assert.ok(
    fs
      .readFileSync(`/proc/${supervisor.pid}/cmdline`, 'utf8')
      .includes('/tests/fixtures/quest-resident/container.cjs')
  )
  process.kill(supervisor.pid, 'SIGUSR2')
  result = { restartRequested: true }
} else throw new Error('Unsupported fixture command')
process.stdout.write(JSON.stringify(result))
