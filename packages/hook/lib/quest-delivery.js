const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const RETENTION = 7 * 86400000
const MAX_EVENTS = 256
const MAX_BYTES = 4 * 1024 * 1024
const EVENT_BYTES = 32 * 1024
const idFor = (run) =>
  crypto.createHash('sha256').update(JSON.stringify(run)).digest('hex')

// This queue contains sanitized execution evidence only. Retrying delivery
// never invokes a script. The app owner must supply persistent private storage.
function createQuestDelivery({
  directory,
  appId,
  deploymentId,
  send,
  now = Date.now,
  warn = () => {}
}) {
  if (
    !path.isAbsolute(directory) ||
    !/^\d+$/.test(String(appId)) ||
    !/^\d+$/.test(String(deploymentId))
  )
    throw new Error(
      'Quest delivery needs a private absolute directory and deployment identity.'
    )
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const stat = fs.lstatSync(directory)
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid() ||
    stat.mode & 0o077
  )
    throw new Error(
      'Quest delivery directory must be private and owned by the app user.'
    )
  const queue = new Map()
  let bytes = 0,
    active = false,
    stopped = false
  const filename = (id) => path.join(directory, id + '.json')
  const valid = (item) =>
    item &&
    /^[a-f0-9]{64}$/.test(item.id) &&
    item.run &&
    String(item.run.appId) === String(appId) &&
    String(item.run.deploymentId) === String(deploymentId) &&
    Number.isSafeInteger(item.run.sequence) &&
    item.run.sequence >= 0 &&
    Number.isFinite(item.run.requestedAt) &&
    item.run.requestedAt <= now() + 60000 &&
    idFor(item.run) === item.id
  const remove = (id) => {
    const item = queue.get(id)
    if (!item) return
    fs.unlinkSync(filename(id))
    queue.delete(id)
    bytes -= item.bytes
  }
  // Never inspect arbitrary files or remove receipts from another deployment.
  const names = fs.readdirSync(directory)
  if (names.length > MAX_EVENTS * 2)
    throw new Error('Quest delivery directory exceeds its file budget.')
  // One deployment writer owns this directory. A crash before rename can leave
  // a bounded temporary receipt; validate its identity before removing it.
  for (const name of names.filter((name) =>
    /^[a-f0-9]{64}\.json\.tmp$/.test(name)
  )) {
    const file = path.join(directory, name),
      stat = fs.lstatSync(file)
    if (
      !stat.isFile() ||
      stat.uid !== process.getuid() ||
      stat.mode & 0o077 ||
      stat.size > EVENT_BYTES
    )
      throw new Error('Quest delivery temporary receipt is unsafe.')
    const item = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!valid(item) || name !== item.id + '.json.tmp')
      throw new Error('Quest delivery temporary receipt identity is invalid.')
    fs.unlinkSync(file)
  }
  const files = names.filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
  if (files.length > MAX_EVENTS)
    throw new Error('Quest delivery directory exceeds its event budget.')
  for (const name of files) {
    const file = path.join(directory, name),
      stat = fs.lstatSync(file)
    if (
      !stat.isFile() ||
      stat.uid !== process.getuid() ||
      stat.mode & 0o077 ||
      stat.size > EVENT_BYTES
    )
      throw new Error(
        'Quest delivery receipt has unsafe ownership or exceeds its budget.'
      )
    const item = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!valid(item) || name !== item.id + '.json')
      throw new Error('Quest delivery receipt identity is invalid.')
    queue.set(item.id, { ...item, bytes: stat.size })
    bytes += stat.size
  }
  if (bytes > MAX_BYTES)
    throw new Error('Quest delivery directory exceeds its byte budget.')
  function expire() {
    for (const [id, item] of queue)
      if (item.run.requestedAt < now() - RETENTION) {
        remove(id)
        warn('Quest delivery evidence expired before acknowledgement.')
      }
  }
  function enqueue(run) {
    if (stopped) return false
    expire()
    const item = { id: idFor(run), run },
      body = JSON.stringify(item),
      size = Buffer.byteLength(body)
    if (
      !valid(item) ||
      size > EVENT_BYTES ||
      run.requestedAt < now() - RETENTION
    )
      return false
    if (queue.has(item.id)) return true
    if (queue.size >= MAX_EVENTS || bytes + size > MAX_BYTES) {
      warn(
        'Quest delivery storage is full; new evidence is unavailable for durable replay.'
      )
      return false
    }
    const temporary = filename(item.id) + '.tmp'
    let fd
    try {
      fd = fs.openSync(temporary, 'wx', 0o600)
      fs.writeFileSync(fd, body)
      fs.fsyncSync(fd)
      fs.closeSync(fd)
      fd = undefined
      fs.renameSync(temporary, filename(item.id))
      const directoryFd = fs.openSync(directory, 'r')
      try {
        fs.fsyncSync(directoryFd)
      } finally {
        fs.closeSync(directoryFd)
      }
      queue.set(item.id, { ...JSON.parse(body), bytes: size })
      bytes += size
      return true
    } finally {
      if (fd !== undefined) fs.closeSync(fd)
      try {
        fs.unlinkSync(temporary)
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
    }
  }
  async function flush() {
    if (active || stopped) return
    active = true
    try {
      expire()
      const batch = [...queue.values()]
        .slice(0, 8)
        .map(({ id, run }) => ({ id, run }))
      if (!batch.length) return
      const response = await send({ questEvents: batch })
      if (!Array.isArray(response?.questAcknowledged)) return
      const submitted = new Set(batch.map((item) => item.id))
      for (const id of response.questAcknowledged)
        if (submitted.has(id)) remove(id)
    } catch {
      warn('Quest delivery is unconfirmed; retained evidence will be retried.')
    } finally {
      active = false
    }
  }
  expire()
  return {
    enqueue,
    flush,
    stop: () => {
      stopped = true
    },
    get pending() {
      return queue.size
    }
  }
}
module.exports = { createQuestDelivery, idFor }
