const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const Database = require('better-sqlite3')
const readSchema = require('./sqlite-schema')
const { digest } = require('./upgrade-ledger')

function failure(message) {
  const error = new Error(message)
  error.code = 'upgradeBackupFailed'
  throw error
}
function checkpoint(database, filename) {
  if (
    database.pragma('integrity_check', { simple: true }) !== 'ok' ||
    database.pragma('foreign_key_check').length
  )
    failure('An upgrade database failed its integrity checks.')
  const schema = readSchema({ path: filename, transaction: { database } })
  if (
    schema.error ||
    Object.values(schema.tables).some((table) => !table.catalogComplete)
  )
    failure('An upgrade database has unsupported native schema.')
  const counts = {}
  for (const name of Object.keys(schema.tables).sort())
    counts[name] = database
      .prepare(`SELECT COUNT(*) AS count FROM "${name.replace(/"/g, '""')}"`)
      .get().count
  return { schemaHash: digest(schema.tables), counts }
}
function syncFile(filename) {
  const descriptor = fs.openSync(filename, 'r')
  try {
    fs.fsyncSync(descriptor)
  } finally {
    fs.closeSync(descriptor)
  }
}
// This adapter must prove all old writers are stopped (including external
// Helm/Quest workers). A coordinator lease alone is not a writer fence.
async function createBackupSet({
  databases,
  directory,
  maxBytes,
  reserveBytes,
  timeoutMs,
  verifyFence
}) {
  if (
    !Array.isArray(databases) ||
    !databases.length ||
    typeof verifyFence !== 'function' ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes <= 0 ||
    !Number.isSafeInteger(reserveBytes) ||
    reserveBytes < 0 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0
  )
    failure(
      'Upgrade backup requires databases, a writer fence and explicit bounds.'
    )
  const deadline = Date.now() + timeoutMs
  const seen = new Set()
  const sources = databases.map((source) => {
    if (
      !['default', 'observability', 'analytics', 'cache'].includes(
        source.datastore
      ) ||
      seen.has(source.datastore) ||
      typeof source.databaseKey !== 'string' ||
      !source.databaseKey
    )
      failure('Upgrade backup targets are invalid or duplicated.')
    seen.add(source.datastore)
    const filename = fs.realpathSync(source.path)
    if (!fs.statSync(filename).isFile())
      failure('An upgrade database is not a file.')
    return { ...source, path: filename }
  })
  if (new Set(sources.map((source) => source.path)).size !== sources.length)
    failure('Upgrade database targets alias the same physical file.')
  const parent = fs.realpathSync(directory)
  if (!fs.statSync(parent).isDirectory())
    failure('Backup destination is not a directory.')
  const capacity = fs.statfsSync(parent)
  const available = capacity.bavail * capacity.bsize - reserveBytes
  if (!Number.isSafeInteger(available) || available < maxBytes)
    failure('Insufficient disk capacity for the bounded upgrade backup.')
  let fenceId
  async function checkFence() {
    if (Date.now() > deadline) failure('Upgrade backup exceeded its deadline.')
    let timer
    let proof
    try {
      proof = await Promise.race([
        verifyFence(sources),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            const error = new Error(
              'Writer fence verification exceeded its deadline.'
            )
            error.code = 'upgradeBackupFailed'
            reject(error)
          }, Math.max(1, deadline - Date.now()))
        })
      ])
    } finally {
      clearTimeout(timer)
    }
    if (Date.now() > deadline) failure('Upgrade backup exceeded its deadline.')
    if (
      !proof ||
      typeof proof.id !== 'string' ||
      !proof.id ||
      proof.writersStopped !== true ||
      digest([...(proof.databaseKeys || [])].sort()) !==
        digest(sources.map((source) => source.databaseKey).sort()) ||
      (fenceId && proof.id !== fenceId)
    )
      failure('The upgrade writer fence could not be verified.')
    fenceId = proof.id
  }
  await checkFence()
  const destination = fs.mkdtempSync(path.join(parent, 'slipway-upgrade-'))
  fs.chmodSync(destination, 0o700)
  const snapshots = []
  let bytes = 0
  try {
    for (const source of sources) {
      await checkFence()
      const database = new Database(source.path, {
        readonly: true,
        fileMustExist: true,
        timeout: Math.min(timeoutMs, 5000)
      })
      const filename = path.join(destination, `${source.datastore}.sqlite`)
      let copy
      try {
        const before = checkpoint(database, source.path)
        const pageSize = database.pragma('page_size', { simple: true })
        const estimated =
          database.pragma('page_count', { simple: true }) * pageSize
        if (estimated + bytes > maxBytes)
          failure('Upgrade databases exceed the backup size limit.')
        const descriptor = fs.openSync(filename, 'wx', 0o600)
        fs.closeSync(descriptor)
        await database.backup(filename, {
          progress({ totalPages }) {
            if (Date.now() > deadline)
              failure('Upgrade backup exceeded its deadline.')
            if (totalPages * pageSize + bytes > maxBytes)
              failure('Upgrade databases exceed the backup size limit.')
            return 128
          }
        })
        bytes += fs.statSync(filename).size
        if (bytes > maxBytes || Date.now() > deadline)
          failure('Upgrade backup exceeded its size or deadline bound.')
        copy = new Database(filename, { readonly: true, fileMustExist: true })
        const recovered = checkpoint(copy, filename)
        if (
          digest(before) !== digest(recovered) ||
          digest(before) !== digest(checkpoint(database, source.path))
        )
          failure('Upgrade backup differs from its fenced source checkpoint.')
        syncFile(filename)
        const fileHash = await hashFile(filename, deadline)
        snapshots.push({
          datastore: source.datastore,
          databaseKey: source.databaseKey,
          file: path.basename(filename),
          fileHash,
          bytes: fs.statSync(filename).size,
          ...recovered
        })
      } finally {
        copy?.close()
        database.close()
      }
      await checkFence()
    }
    const receipt = { format: 1, fenceId, bytes, snapshots }
    const receiptPath = path.join(destination, 'receipt.json')
    fs.writeFileSync(receiptPath, JSON.stringify(receipt), {
      flag: 'wx',
      mode: 0o600
    })
    syncFile(receiptPath)
    syncFile(destination)
    await checkFence()
    return { directory: destination, id: digest(receipt), receipt }
  } catch (error) {
    // No live DDL has occurred; incomplete sets must never authorize mutation.
    fs.rmSync(destination, { recursive: true, force: true })
    throw error
  }
}

async function hashFile(filename, deadline) {
  const hash = crypto.createHash('sha256')
  for await (const chunk of fs.createReadStream(filename)) {
    if (Date.now() > deadline)
      failure('Upgrade backup verification exceeded its deadline.')
    hash.update(chunk)
  }
  return hash.digest('hex')
}
async function verifyBackupSet(set, timeoutMs) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
    failure('Backup verification requires an explicit deadline.')
  const deadline = Date.now() + timeoutMs
  const receiptPath = path.join(set.directory, 'receipt.json')
  const receiptStat = fs.lstatSync(receiptPath)
  if (
    !receiptStat.isFile() ||
    receiptStat.size > 1024 * 1024 ||
    (receiptStat.mode & 0o777) !== 0o600
  )
    failure('The durable backup receipt is not a private bounded file.')
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'))
  if (
    digest(receipt) !== set.id ||
    !Array.isArray(receipt.snapshots) ||
    !receipt.snapshots.length
  )
    failure('The durable backup receipt changed.')
  for (const snapshot of receipt.snapshots) {
    if (
      !['default', 'observability', 'analytics', 'cache'].includes(
        snapshot.datastore
      ) ||
      snapshot.file !== `${snapshot.datastore}.sqlite`
    )
      failure('The durable backup target is invalid.')
    const filename = path.join(set.directory, snapshot.file)
    const stat = fs.lstatSync(filename)
    if (
      !stat.isFile() ||
      stat.size !== snapshot.bytes ||
      (stat.mode & 0o777) !== 0o600 ||
      (await hashFile(filename, deadline)) !== snapshot.fileHash
    )
      failure('A durable backup file changed.')
    const db = new Database(filename, { readonly: true, fileMustExist: true })
    try {
      const current = checkpoint(db, filename)
      if (
        current.schemaHash !== snapshot.schemaHash ||
        digest(current.counts) !== digest(snapshot.counts)
      )
        failure('A durable backup checkpoint changed.')
    } finally {
      db.close()
    }
  }
  return receipt
}
module.exports = { createBackupSet, verifyBackupSet }
