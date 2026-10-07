#!/usr/bin/env node
// Offline operator tooling. Importing this file never lifts Sails or opens files.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const v8 = require('node:v8')
const { execFileSync } = require('node:child_process')
const { pipeline } = require('node:stream/promises')
const zlib = require('node:zlib')
const tar = require('tar-stream')
const Database = require('better-sqlite3')
const migrations = require('../api/lib/release-migrations')
const files = Object.values(migrations.files)
const quote = (name) => '"' + name.replaceAll('"', '""') + '"'

function verify(db) {
  if (db.pragma('integrity_check', { simple: true }) !== 'ok')
    throw new Error('SQLite integrity check failed')
  if (db.pragma('foreign_key_check').length)
    throw new Error('SQLite foreign-key check failed')
}

async function snapshot(source, destination) {
  const db = new Database(source, { readonly: true, fileMustExist: true })
  try {
    await db.backup(destination, {
      progress({ totalPages }) {
        const stats = fs.statfsSync(path.dirname(destination))
        if (Number(stats.bavail) * Number(stats.bsize) < 512 * 1024 * 1024)
          throw new Error(
            'Insufficient free disk space for a verified snapshot'
          )
        if (
          totalPages * db.pragma('page_size', { simple: true }) >
          50 * 1024 ** 3
        )
          throw new Error('Database snapshot exceeds the 50 GiB safety bound')
        return 200
      }
    })
  } finally {
    db.close()
  }
  const copy = new Database(destination, {
    readonly: true,
    fileMustExist: true
  })
  try {
    verify(copy)
  } finally {
    copy.close()
  }
  fs.chmodSync(destination, 0o600)
}

function objects(db) {
  return db
    .prepare(
      `SELECT type, name, tbl_name, sql FROM sqlite_schema
    WHERE sql IS NOT NULL AND lower(name) NOT GLOB 'sqlite_*'
    AND name <> 'lost_and_found' ORDER BY type, name`
    )
    .all()
}

function rows(db, table) {
  const columns = db.prepare(`PRAGMA table_info(${quote(table)})`).all()
  const order = columns
    .map((column) => quote(column.name) + ' COLLATE BINARY')
    .join(', ')
  const hash = crypto.createHash('sha256')
  let count = 0
  for (const row of db
    .prepare(`SELECT * FROM ${quote(table)} NOT INDEXED ORDER BY ${order}`)
    .raw()
    .iterate()) {
    const bytes = v8.serialize(row)
    const length = Buffer.alloc(4)
    length.writeUInt32BE(bytes.length)
    hash.update(length).update(bytes)
    count++
  }
  return { count, hash: hash.digest('hex') }
}

function parity(source, recovered) {
  const original = new Database(source, { readonly: true, fileMustExist: true })
  const candidate = new Database(recovered, {
    readonly: true,
    fileMustExist: true
  })
  original.defaultSafeIntegers(true)
  candidate.defaultSafeIntegers(true)
  try {
    verify(candidate)
    if (
      original
        .prepare("SELECT 1 FROM sqlite_schema WHERE name='lost_and_found'")
        .get()
    )
      throw new Error(
        'Source already contains lost_and_found; review existing salvage evidence before recovery'
      )
    if (
      JSON.stringify(objects(original)) !== JSON.stringify(objects(candidate))
    )
      throw new Error(
        'Recovered application schema differs; live storage must not be replaced'
      )
    const tables = original
      .prepare(
        `SELECT name FROM sqlite_schema WHERE type='table'
      AND (lower(name) NOT GLOB 'sqlite_*' OR name='sqlite_sequence')
      AND name <> 'lost_and_found' ORDER BY name`
      )
      .all()
    const verified = []
    for (const { name } of tables) {
      const before = rows(original, name)
      const after = rows(candidate, name)
      if (before.count !== after.count || before.hash !== after.hash)
        throw new Error(
          `Recovered application table differs: ${name}; live storage must not be replaced`
        )
      verified.push({ table: name, rows: before.count })
    }
    return verified
  } finally {
    original.close()
    candidate.close()
  }
}

async function bundle(directory, output) {
  fs.mkdirSync(output, { mode: 0o700 })
  const manifest = {
    version: 1,
    consistency:
      'independent SQLite snapshots; not a cross-database transaction',
    databases: []
  }
  for (const file of files) {
    const startedAt = new Date().toISOString()
    const target = path.join(output, file)
    await snapshot(path.join(directory, file), target)
    const hash = crypto.createHash('sha256')
    for await (const bytes of fs.createReadStream(target)) hash.update(bytes)
    manifest.databases.push({
      file,
      startedAt,
      completedAt: new Date().toISOString(),
      bytes: fs.statSync(target).size,
      sha256: hash.digest('hex'),
      integrity: 'ok',
      foreignKeys: 'ok'
    })
  }
  fs.writeFileSync(
    path.join(output, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    { mode: 0o600 }
  )
  const pack = tar.pack()
  const archive = path.join(output, 'system.tar.gz')
  const pending = pipeline(
    pack,
    zlib.createGzip(),
    fs.createWriteStream(archive, { mode: 0o600 })
  )
  // Observe rejection immediately; a disk failure must not become unhandled.
  pending.catch(() => {})
  try {
    for (const file of [...files, 'manifest.json']) {
      const entry = pack.entry({
        name: file,
        size: fs.statSync(path.join(output, file)).size,
        mode: 0o600
      })
      await pipeline(fs.createReadStream(path.join(output, file)), entry)
    }
    pack.finalize()
    await pending
  } catch (error) {
    pack.destroy(error)
    await pending.catch(() => {})
    throw error
  }
  return { directory: output, archive, manifest }
}

async function check(
  directory,
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'slipway-db-check-'))
) {
  scratch = fs.realpathSync(scratch)
  if (
    path.dirname(scratch) !== fs.realpathSync(os.tmpdir()) ||
    !path.basename(scratch).startsWith('slipway-db-check-') ||
    fs.readdirSync(scratch).length !== 0
  )
    throw new Error(
      'Verification scratch must be a new empty private temporary directory'
    )
  const results = []
  try {
    for (const file of files) {
      try {
        await snapshot(path.join(directory, file), path.join(scratch, file))
        results.push({ database: file, ok: true })
      } catch (error) {
        results.push({
          database: file,
          ok: false,
          code: error.code || 'verificationFailed'
        })
      }
    }
    return { ok: results.every((item) => item.ok), results }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true })
  }
}

// Source must be a stopped, consistent snapshot. This command only creates a
// new candidate directory; it cannot replace or reset a live database.
async function prepare({ source, output, sqlite, resetObservability }) {
  if (!resetObservability)
    throw new Error(
      'Explicit --reset-observability is required; observability history will be discarded in the candidate only'
    )
  source = fs.realpathSync(source)
  output = path.resolve(output)
  if (output === source || output.startsWith(source + path.sep))
    throw new Error('Candidate must be outside the source snapshot')
  for (const file of files) {
    const stat = fs.lstatSync(path.join(source, file))
    if (!stat.isFile() || stat.nlink !== 1)
      throw new Error('Source databases must be distinct regular files')
  }
  fs.mkdirSync(output, { mode: 0o700 }) // Never overwrite an existing candidate.
  const sqlPath = path.join(output, 'app-recovery.sql')
  const descriptor = fs.openSync(sqlPath, 'wx', 0o600)
  try {
    execFileSync(
      sqlite,
      ['-readonly', path.join(source, 'app.db'), '.recover --ignore-freelist'],
      {
        stdio: ['ignore', descriptor, 'pipe'],
        timeout: 300000
      }
    )
  } finally {
    fs.closeSync(descriptor)
  }
  const app = path.join(output, 'app.db')
  execFileSync(sqlite, ['-bail', app], {
    input: '.dbconfig defensive off\n.read ' + JSON.stringify(sqlPath) + '\n',
    timeout: 300000,
    stdio: ['pipe', 'ignore', 'pipe']
  })
  fs.chmodSync(app, 0o600)
  const verifiedTables = parity(path.join(source, 'app.db'), app)
  const original = new Database(path.join(source, 'observability.db'), {
    readonly: true,
    fileMustExist: true
  })
  const empty = new Database(path.join(output, 'observability.db'))
  try {
    // Recreate the captured schema, including custom views/triggers/indexes.
    // Planner statistics and release receipt rows are intentionally absent.
    const catalog = objects(original)
    empty.transaction(() => {
      for (const type of ['table', 'index', 'view', 'trigger'])
        for (const object of catalog.filter((item) => item.type === type))
          empty.exec(object.sql)
    })()
    verify(empty)
  } finally {
    original.close()
    empty.close()
  }
  for (const file of ['analytics.db', 'stash.db'])
    await snapshot(path.join(source, file), path.join(output, file))
  for (const file of files) fs.chmodSync(path.join(output, file), 0o600)
  const report = {
    prepared: true,
    liveStorageChanged: false,
    observabilityReset: true,
    verifiedTables
  }
  fs.writeFileSync(
    path.join(output, 'verification.json'),
    JSON.stringify(report, null, 2) + '\n',
    { mode: 0o600 }
  )
  return report
}

async function main(args) {
  const command = args.shift()
  const options = {}
  while (args.length) {
    const key = args.shift()
    if (key === '--reset-observability') options.resetObservability = true
    else if (
      ['--directory', '--source', '--output', '--sqlite', '--scratch'].includes(
        key
      ) &&
      args.length
    )
      options[key.slice(2)] = args.shift()
    else throw new Error('Unknown or incomplete option: ' + key)
  }
  if (command === 'snapshot' && options.directory && options.output)
    return bundle(options.directory, options.output)
  if (command === 'check' && options.directory)
    return check(options.directory, options.scratch)
  if (
    command === 'prepare' &&
    options.source &&
    options.output &&
    options.sqlite
  )
    return prepare(options)
  if (command === 'migrate' && options.directory) {
    const result = await migrations.run({ directory: options.directory })
    return {
      ...result,
      receipts: Object.fromEntries(
        Object.entries(migrations.files).map(([datastore, file]) => [
          datastore,
          migrations.current({
            path: path.join(options.directory, file),
            datastore
          })
        ])
      )
    }
  }
  throw new Error(
    'Usage: check --directory DIR | prepare --source SNAPSHOT --output NEW_DIR --sqlite RECOVERY_CLI --reset-observability | migrate --directory CANDIDATE'
  )
}

module.exports = { snapshot, bundle, parity, check, prepare, verify, main }
if (require.main === module)
  main(process.argv.slice(2))
    .then((result) => {
      console.log(JSON.stringify(result, null, 2))
      if (result.ok === false) process.exitCode = 1
    })
    .catch((error) => {
      console.error(
        JSON.stringify({
          error: error.message,
          code: error.code || 'recoveryFailed',
          liveStorageChanged: false
        })
      )
      process.exitCode = 1
    })
