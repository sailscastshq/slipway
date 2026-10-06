// Fixed fixture-only child: metadata and hashes, never SQL, rows or file paths.
const fs = require('node:fs')
const path = require('node:path')
const { fork } = require('node:child_process')
const lib = fs.existsSync('/app/api/lib/sqlite-schema.js')
  ? '/app/api/lib'
  : path.resolve(__dirname, '../../../api/lib')
const { digest } = require(path.join(lib, 'upgrade-ledger'))
const readSchema = require(path.join(lib, 'sqlite-schema'))
const profiles = ['0.0.86', '0.0.87', 'legacy-86-to-87', 'bosun-86-to-87'].map(
  (name) => require(path.join(lib, 'upgrades/baselines', name + '.json'))
)
const stores = ['default', 'observability', 'analytics', 'cache']
function collect({ services, steps }) {
  const reports = []
  if (
    !Array.isArray(services) ||
    services.length !== 4 ||
    !Array.isArray(steps)
  )
    return { status: 'unconfirmed' }
  for (const datastore of stores) {
    const service = services.find((item) => item.datastore === datastore)
    if (!service) return { status: 'unconfirmed' }
    const catalog = readSchema(service)
    if (catalog.error) {
      reports.push({
        datastore,
        status: 'unreadable',
        sqliteCode: /^SQLITE_[A-Z_]+$/.test(catalog.errorCode || '')
          ? catalog.errorCode
          : 'unconfirmed'
      })
      continue
    }
    const schemaHash = digest(catalog.tables)
    const mismatches = []
    let unknownTables = 0
    let mismatchCount = 0
    for (const [name, table] of Object.entries(catalog.tables)) {
      const known = profiles
        .map((profile) => profile.databases[datastore]?.schema[name])
        .filter(Boolean)
      if (!known.length) {
        unknownTables++
        continue // Unknown names may be sensitive; do not emit them.
      }
      const components = [
        'sql',
        'columns',
        'foreignKeys',
        'triggers',
        'views',
        'catalogComplete'
      ]
      const changed = components.filter(
        (key) =>
          !known.some(
            (candidate) =>
              digest(candidate[key] ?? null) === digest(table[key] ?? null)
          )
      )
      const body = ({ indexes, ...definition }) => definition
      const bodyMatchesKnown = known.some(
        (candidate) => digest(body(candidate)) === digest(body(table))
      )
      const unknownIndexes = table.indexes.filter(
        (index) =>
          !known.some((candidate) =>
            candidate.indexes.some(
              (registered) =>
                registered.name === index.name && registered.sql === index.sql
            )
          )
      ).length
      if (!bodyMatchesKnown || unknownIndexes) {
        mismatchCount++
        if (mismatches.length < 8)
          mismatches.push({
            table: name,
            changed,
            bodyMatchesKnown,
            unknownIndexes,
            tableHash: digest(table)
          })
      }
    }
    reports.push({
      datastore,
      status: 'readable',
      schemaHash,
      matchesReviewed:
        schemaHash ===
        steps.find((step) => step.datastore === datastore)?.fromSchemaHash,
      tableCount: Object.keys(catalog.tables).length,
      unknownTables,
      mismatchCount,
      mismatches
    })
  }
  return { status: 'captured', reports }
}
function bounded(input) {
  return new Promise((resolve) => {
    let child
    try {
      child = fork(__filename, ['--collect'], {
        execArgv: ['--max-old-space-size=64'],
        env: { PATH: process.env.PATH },
        stdio: ['ignore', 'ignore', 'ignore', 'ipc']
      })
    } catch {
      return resolve({ status: 'unconfirmed' })
    }
    let result = { status: 'unconfirmed' }
    const timer = setTimeout(() => {
      result = { status: 'timeout' }
      child.kill('SIGKILL')
    }, 5000)
    child.on('message', (message) => {
      if (Buffer.byteLength(JSON.stringify(message)) <= 16384) result = message
      else result = { status: 'outputLimit' }
    })
    child.on('error', () => {
      result = { status: 'unconfirmed' }
    })
    child.on('close', () => {
      clearTimeout(timer)
      resolve(result)
    })
    try {
      child.send(input, (error) => {
        if (error) child.kill('SIGKILL')
      })
    } catch {
      child.kill('SIGKILL')
    }
  })
}
if (require.main === module && process.argv[2] === '--collect') {
  process.once('message', (input) => {
    try {
      process.send(collect(input), () => process.exit(0))
    } catch {
      process.send({ status: 'unconfirmed' }, () => process.exit(1))
    }
  })
}
module.exports = { collect, bounded }
