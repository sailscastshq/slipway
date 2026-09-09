const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
module.exports = function supportAudit(sails, appId, send) {
  const directory = path.join(sails.config.appPath, '.tmp', 'slipway-support')
  const filename = path.join(
    directory,
    crypto
      .createHash('sha256')
      .update(String(appId))
      .digest('hex')
      .slice(0, 24) + '.json'
  )
  let queue = [],
    flushing,
    stopping = false
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  try {
    queue = JSON.parse(fs.readFileSync(filename, 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  if (!Array.isArray(queue) || queue.length > 1000)
    throw Error('Invalid support audit outbox.')
  function persist() {
    const temporary = filename + '.tmp'
    fs.writeFileSync(temporary, JSON.stringify(queue), { mode: 0o600 })
    fs.renameSync(temporary, filename)
  }
  async function flush() {
    if (flushing) return flushing
    flushing = (async () => {
      for (let n = 0; n < 10 && queue.length && !stopping; n++) {
        await send({ action: 'event', ...queue[0] })
        queue.shift()
        persist()
      }
    })().finally(() => {
      flushing = null
    })
    return flushing
  }
  async function record(session, event, requireAck = false) {
    if (queue.length >= 1000) throw Error('The support audit outbox is full.')
    const entry = {
      grantId: String(session.id),
      event,
      eventId: crypto.randomBytes(16).toString('hex'),
      occurredAt: Date.now()
    }
    queue.push(entry)
    persist()
    if (requireAck) {
      await flush()
      if (queue.some((item) => item.eventId === entry.eventId))
        throw Error('Support audit delivery is pending.')
    } else
      flush().catch(() =>
        sails.log.warn(
          'Support audit delivery is pending; the local outbox will retry.'
        )
      )
  }
  return {
    record,
    flush,
    stop: async () => {
      stopping = true
      await flushing?.catch(() => {})
    }
  }
}
