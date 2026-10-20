// Synthetic only: exact cached image native runtime, no production data/socket/network.
const fs = require('fs'),
  path = require('path'),
  { fork } = require('child_process')
const D = require('/app/node_modules/better-sqlite3')
const { createRedactor } =
  require('/fixture/api/helpers/security/redact')._private
const root = '/tmp/slipway-native-fixture'
fs.mkdirSync(root, { recursive: true })
const names = ['app', 'observability', 'analytics', 'stash']
function open(name) {
  const d = new D(path.join(root, name + '.db'))
  d.pragma('journal_mode=WAL')
  d.pragma('mmap_size=0')
  d.pragma('cache_size=-262144')
  d.pragma('busy_timeout=1000')
  return d
}
async function main() {
  if (process.argv.includes('--worker')) {
    let ok = 0,
      busy = 0
    for (let i = 0; i < 40; i++) {
      const d = open('observability')
      try {
        d.prepare('SELECT count(*) n FROM records').get()
        d.prepare('INSERT INTO records(payload) VALUES(?)').run(
          'synthetic worker'
        )
        ok++
      } catch (e) {
        if (e.code === 'SQLITE_BUSY') busy++
        else throw e
      } finally {
        d.close()
      }
      await new Promise((r) => setTimeout(r, 25))
    }
    process.send?.({ workerOk: ok, busy })
    return
  }
  const dbs = names.map(open)
  for (const [i, d] of dbs.entries()) {
    d.exec(
      'CREATE TABLE records(id INTEGER PRIMARY KEY,payload TEXT);CREATE TABLE logs(id INTEGER PRIMARY KEY,payload TEXT)'
    )
    const q = d.prepare('INSERT INTO records(payload) VALUES(?)'),
      text = 'synthetic payload '.padEnd(1024, 'x')
    d.transaction(() => {
      for (let n = 0; n < (i === 1 ? 32768 : 1024); n++) q.run(text)
    })()
  }
  const workers = Array.from({ length: 2 }, () =>
    fork(__filename, ['--worker'], {
      stdio: ['ignore', 'ignore', 'inherit', 'ipc']
    })
  )
  const workerResults = workers.map(
    (p) =>
      new Promise((resolve, reject) => {
        let result
        p.on('message', (x) => (result = x))
        p.on('exit', (code, signal) =>
          code === 0
            ? resolve(result)
            : reject(Error('worker ' + code + ' ' + signal))
        )
      })
  )
  const redact = createRedactor()
  for (let n = 0; n < 40; n++)
    redact.remember({ password: 'synthetic-secret-' + n + '-only' })
  const log =
    '2026-10-20T11:00:00Z synthetic log with synthetic-secret-3-only\n'.repeat(
      89146
    )
  const started = Date.now()
  let maxRss = 0
  for (let n = 0; n < 40; n++) {
    const cleaned = redact.protect(log)
    if (cleaned.includes('synthetic-secret-3-only'))
      throw Error('redaction regression')
    const d = dbs[1]
    d.prepare('INSERT INTO logs(payload) VALUES(?)').run(cleaned)
    d.prepare('DELETE FROM logs WHERE id < ?').run(n - 2)
    d.prepare('SELECT sum(length(payload)) n FROM records').get()
    d.prepare(
      'DELETE FROM records WHERE id IN (SELECT id FROM records WHERE payload=? LIMIT 10)'
    ).run('synthetic worker')
    maxRss = Math.max(maxRss, process.memoryUsage().rss)
    if (n % 10 === 0)
      console.log(
        JSON.stringify({
          cycle: n,
          elapsedMs: Date.now() - started,
          rssMiB: Math.round(maxRss / 1048576)
        })
      )
    await new Promise((r) => setTimeout(r, 10))
  }
  console.log(
    JSON.stringify({
      completedCycles: 40,
      workerResults: await Promise.all(workerResults),
      elapsedMs: Date.now() - started,
      maxRssMiB: maxRss / 1048576,
      node: process.version,
      arch: process.arch,
      sqlite: JSON.parse(
        fs.readFileSync('/app/node_modules/better-sqlite3/package.json')
      ).version,
      method:
        'synthetic SQLite WAL readers/writers plus multi-megabyte redaction, mmap=0, two short-lived console analogues; excludes full Sails/production data; x64 emulation on ARM64 Mac'
    })
  )
  dbs.forEach((d) => d.close())
}
main().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
