module.exports = {
  friendlyName: 'Stream update progress',
  inputs: {},
  exits: { success: {} },
  fn: async function () {
    const stream = this.res.sse()
    let last,
      reading = false,
      closed = false,
      timer
    const send = async () => {
      if (reading || closed) return
      reading = true
      try {
        const status = await sails.helpers.system.getUpdateStatus()
        const value = JSON.stringify(status)
        if (!closed && value !== last) {
          stream.send(status)
          last = value
        }
      } catch {
        /* HTTP polling can reconcile without inventing a terminal outcome. */
      } finally {
        reading = false
      }
    }
    stream.onClose(() => {
      closed = true
      clearInterval(timer)
    })
    await send()
    if (!closed) timer = setInterval(send, 2000)
    return stream.wait()
  }
}
