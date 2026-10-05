const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const ledger = require('./upgrade-ledger')

function fail() {
  throw Object.assign(
    new Error('Upgrade storage could not be staged safely.'),
    {
      code: 'upgradeStorageMismatch'
    }
  )
}
function limits(maxBytes, timeoutMs) {
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes <= 0 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0
  )
    fail()
  const deadline = Date.now() + timeoutMs
  return () => {
    if (Date.now() > deadline) fail()
  }
}
function fileDigest(filename, maxBytes, check) {
  const fd = fs.openSync(
    filename,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW
  )
  try {
    const before = fs.fstatSync(fd)
    if (!before.isFile() || before.size > maxBytes) fail()
    const hash = crypto.createHash('sha256')
    const buffer = Buffer.alloc(64 * 1024)
    let bytes = 0
    let size
    while ((size = fs.readSync(fd, buffer, 0, buffer.length, null))) {
      check()
      bytes += size
      if (bytes > maxBytes) fail()
      hash.update(buffer.subarray(0, size))
    }
    const after = fs.fstatSync(fd)
    if (
      before.size !== bytes ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    )
      fail()
    return { bytes, hash: hash.digest('hex') }
  } finally {
    fs.closeSync(fd)
  }
}
function inspectStorage({ directory, maxBytes, timeoutMs }) {
  const check = limits(maxBytes, timeoutMs)
  const root = fs.realpathSync(directory)
  const entries = []
  let total = 0
  function walk(relative) {
    check()
    const filename = path.join(root, relative)
    const stat = fs.lstatSync(filename)
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) fail()
    if (entries.length >= 100000) fail()
    if (stat.isDirectory()) {
      if (relative) entries.push({ path: relative, directory: true })
      for (const name of fs.readdirSync(filename).sort())
        walk(path.join(relative, name))
    } else {
      // Hashes cover session storage, encrypted rows, keys and opaque files;
      // no values or file contents enter the report or exception text.
      const content = fileDigest(filename, maxBytes - total, check)
      total += content.bytes
      entries.push({ path: relative, ...content })
    }
  }
  walk('')
  const stat = fs.statSync(root)
  return {
    directory: root,
    device: stat.dev,
    inode: stat.ino,
    totalBytes: total,
    entries,
    hash: ledger.digest(entries)
  }
}
function sync(filename) {
  const fd = fs.openSync(filename, 'r')
  try {
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
}
function stageStorage({
  source,
  directory,
  maxBytes,
  timeoutMs,
  reserveBytes = 0
}) {
  const check = limits(maxBytes, timeoutMs)
  const before = inspectStorage({ directory: source, maxBytes, timeoutMs })
  if (!Number.isSafeInteger(reserveBytes) || reserveBytes < 0) fail()
  const parent = fs.realpathSync(directory)
  const space = fs.statfsSync(parent, { bigint: true })
  if (
    space.bavail * space.bsize <
    BigInt(before.totalBytes) + BigInt(reserveBytes)
  )
    fail()
  if (
    parent === before.directory ||
    parent.startsWith(before.directory + path.sep)
  )
    fail()
  const root = fs.mkdtempSync(path.join(parent, 'storage-'))
  fs.chmodSync(root, 0o700)
  const destination = path.join(root, 'data')
  fs.mkdirSync(destination, { mode: 0o700 })
  try {
    for (const entry of before.entries) {
      check()
      const target = path.join(destination, entry.path)
      if (entry.directory) fs.mkdirSync(target, { mode: 0o700 })
      else {
        fs.copyFileSync(
          path.join(before.directory, entry.path),
          target,
          fs.constants.COPYFILE_EXCL
        )
        fs.chmodSync(target, 0o600)
        sync(target)
      }
    }
    const after = inspectStorage({ directory: source, maxBytes, timeoutMs })
    const copy = inspectStorage({ directory: destination, maxBytes, timeoutMs })
    if (
      before.hash !== after.hash ||
      before.device !== after.device ||
      before.inode !== after.inode ||
      copy.hash !== before.hash
    )
      fail()
    for (const entry of [...before.entries].reverse())
      if (entry.directory) sync(path.join(destination, entry.path))
    sync(destination)
    sync(root)
    const { entries, ...sourceIdentity } = before
    return {
      directory: root,
      dataDirectory: destination,
      source: sourceIdentity,
      fileCount: entries.filter((entry) => !entry.directory).length,
      copyHash: copy.hash
    }
  } catch {
    fs.rmSync(root, { recursive: true, force: true })
    fail()
  }
}
function verifySource({ stage, maxBytes, timeoutMs }) {
  const current = inspectStorage({
    directory: stage.source.directory,
    maxBytes,
    timeoutMs
  })
  if (
    current.device !== stage.source.device ||
    current.inode !== stage.source.inode ||
    current.hash !== stage.source.hash
  )
    fail()
  return true
}
module.exports = { inspectStorage, stageStorage, verifySource }
