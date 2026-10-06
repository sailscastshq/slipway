const ledger = require('../../../../lib/quest-run-ledger')
const workspace = require('../../../../lib/quest-workspace')
const liveLogs = require('../../../../lib/quest-live-logs')
let viewers = 0
const active = new Set(['running', 'cancelling', 'unconfirmed'])
module.exports = {
  friendlyName: 'Get Quest run logs',
  description:
    'Read scoped sanitized logs; opt-in resident live snapshots have bounded replay.',
  inputs: {
    projectSlug: { type: 'string', required: true },
    environmentSlug: { type: 'string', defaultsTo: 'production' },
    appId: { type: 'number' },
    runId: { type: 'string', required: true },
    stream: { type: 'boolean', defaultsTo: false },
    afterSequence: { type: 'number', defaultsTo: 0 }
  },
  exits: {
    notFound: { statusCode: 404 },
    conflict: { statusCode: 409 },
    tooManyRequests: { statusCode: 429 }
  },
  fn: async function (inputs) {
    const scope = await ledger.resolveScope(this.req, inputs)
    const run = await ledger.getRun(scope, inputs.runId)
    if (!run) throw 'notFound'
    if (!inputs.stream) {
      const logs = await ledger.getLogs(scope, inputs.runId)
      if (!logs) throw 'notFound'
      return logs
    }
    const cursor = Number(
      this.req.headers['last-event-id'] || inputs.afterSequence
    )
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw 'conflict'
    if (viewers >= 128) throw 'tooManyRequests'
    const context = await workspace.resolveContext(
      this.req,
      inputs.projectSlug,
      inputs.environmentSlug
    )
    const current = await workspace.snapshot(context)
    if (
      !current.capabilities.liveLogs ||
      current.target.runtimeId !== run.runtimeId ||
      run.deploymentId !== String(context.app.currentDeployment)
    )
      throw {
        conflict: {
          message:
            'Replayable live logs are unavailable for this owning runtime.'
        }
      }
    const stream = this.res.sse()
    viewers++
    let busy = false,
      after = cursor,
      timer,
      first = true
    const refresh = async () => {
      if (stream.closed || busy) return
      busy = true
      try {
        const scoped = await workspace.resolveContext(
          this.req,
          inputs.projectSlug,
          inputs.environmentSlug
        )
        if (
          String(scoped.app.currentDeployment) !== run.deploymentId ||
          scoped.app.status !== 'running'
        )
          throw new Error('Owning deployment is unavailable.')
        const snapshot = await liveLogs(scoped.app, run, after)
        if (!stream.closed) {
          if (first || snapshot.sequence > after)
            stream.send({ ...snapshot, available: true })
          first = false
          after = Math.max(after, snapshot.sequence)
          if (!active.has(snapshot.state)) stream.close?.()
        }
      } catch {
        if (!stream.closed)
          stream.send({
            connection: 'unavailable',
            message:
              'Live logs are unconfirmed. Reconnect to reconcile; this does not stop or repeat the job.'
          })
      } finally {
        busy = false
      }
    }
    stream.onClose(() => {
      clearInterval(timer)
      viewers--
    })
    timer = setInterval(refresh, 1000)
    await refresh()
    return stream.wait()
  }
}
