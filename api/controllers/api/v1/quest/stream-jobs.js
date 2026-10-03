const workspace = require('../../../../lib/quest-workspace')
module.exports = {
  friendlyName: 'Stream Quest jobs',
  description:
    'Share bounded resident snapshots without lifting another Sails app.',
  inputs: {
    projectSlug: { type: 'string', required: true },
    environmentSlug: { type: 'string', defaultsTo: 'production' }
  },
  exits: { success: {}, notFound: { statusCode: 404 } },
  fn: async function ({ projectSlug, environmentSlug }) {
    await workspace.resolveContext(this.req, projectSlug, environmentSlug)
    const stream = this.res.sse()
    let busy = false,
      last = ''
    const send = async () => {
      if (stream.closed || busy) return
      busy = true
      try {
        const context = await workspace.resolveContext(
          this.req,
          projectSlug,
          environmentSlug
        )
        const current = await workspace.snapshot(context)
        const payload = { workspace: current }
        const fingerprint = JSON.stringify(payload)
        if (!stream.closed && fingerprint !== last) {
          last = fingerprint
          stream.send(payload)
        }
      } catch {
        if (!stream.closed) stream.send({ error: 'Quest refresh unavailable.' })
      } finally {
        busy = false
      }
    }
    await send()
    const timer = setInterval(send, 5000)
    stream.onClose(() => clearInterval(timer))
    return stream.wait()
  }
}
