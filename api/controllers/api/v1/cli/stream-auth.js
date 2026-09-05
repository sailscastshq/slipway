module.exports = {
  friendlyName: 'Stream CLI auth',
  inputs: {},
  exits: {
    success: {},
    unauthorized: { statusCode: 401 },
    busy: { statusCode: 429 }
  },
  fn: async function () {
    const header = this.req.headers.authorization || ''
    if (!header.startsWith('Device ')) throw 'unauthorized'
    const deviceCode = header.slice(7)
    const sessions = sails.helpers.cli.authSessions()
    const release = sessions.acquireStream(deviceCode)
    if (!release) throw 'busy'
    const stream = this.res.sse()
    const poll = () => {
      const result = sessions.readDevice(deviceCode)
      stream.send(result || { status: 'expired', closed: true })
      if (!result || result.status === 'authenticated') stream.close()
    }
    const interval = setInterval(poll, 1000)
    stream.onClose(() => {
      clearInterval(interval)
      release()
    })
    poll()
    return stream.wait()
  }
}
