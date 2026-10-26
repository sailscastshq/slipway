module.exports = {
  friendlyName: 'Stream update progress',
  inputs: {},
  exits: { success: {} },
  fn: async function () {
    const stream = this.res.sse()
    let last,
      reading = false
    const send = async () => {
      if (reading) return
      reading = true
      try {
        const status = await sails.helpers.system.getUpdateStatus()
        const value = JSON.stringify(status)
        if (value !== last) {
          stream.send(status)
          last = value
        }
      } catch {
        /* HTTP polling can reconcile without inventing a terminal outcome. */
      } finally {
        reading = false
      }
    }
    await send()
    const timer = setInterval(send, 2000)
    stream.onClose(() => clearInterval(timer))
    return stream.wait()
  }
}
