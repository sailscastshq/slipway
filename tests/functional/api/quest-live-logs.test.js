const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { test } = require('sounding')
const workspace = require('../../../api/lib/quest-workspace')
const {
  worldFor,
  residentFixture,
  bearerRequest
} = require('../../support/quest-resident-fixture')

test(
  'real HTTP live logs replay by exact cursor and close on withdrawn tenant authority without rerunning',
  { transport: 'http', world: worldFor('quest-live-logs') },
  async (context) => {
    const { sails, world } = context
    const f = await residentFixture(context, 'quest-live-logs')
    const controllers = []
    try {
      const user = world.current.users.genesisUser
      const client = await bearerRequest(context, user)
      const admitted = await client.post(
        `${f.base}/jobs/synthetic-report/run`,
        f.body()
      )
      assert.equal(admitted.status, 202)
      f.info.capabilities.liveLogs = true
      f.bridge.record('log', {
        name: f.job.name,
        runId: admitted.data.run.runId,
        runtimeId: f.info.runtimeId,
        sequence: 2,
        logs: { stdout: 'Synthetic retained line\n', stderr: '' }
      })
      workspace.invalidate(f.app)
      const token = crypto.randomBytes(32).toString('hex')
      await sails.models.clitoken.create({
        user: user.id,
        token: crypto.createHash('sha256').update(token).digest('hex')
      })
      const address = sails.hooks.http.server.address()
      async function open(cursor) {
        const controller = new AbortController()
        controllers.push(controller)
        const response = await fetch(
          `http://127.0.0.1:${address.port}${f.base}/runs/${admitted.data.run.runId}/logs?stream=true&afterSequence=${cursor}`,
          {
            headers: {
              authorization: `Bearer sl_${token}`,
              Accept: 'text/event-stream'
            },
            signal: controller.signal
          }
        )
        assert.equal(response.status, 200)
        const reader = response.body.getReader()
        let text = ''
        while (!text.includes('\n\n'))
          text += new TextDecoder().decode((await reader.read()).value)
        return {
          reader,
          first: JSON.parse(
            text
              .split('\n')
              .find((line) => line.startsWith('data:'))
              .slice(5)
          )
        }
      }
      const initial = await open(0)
      assert.equal(initial.first.runId, admitted.data.run.runId)
      assert.equal(initial.first.sequence, 2)
      assert.equal(initial.first.entries.length, 1)
      assert.match(initial.first.stdout, /Synthetic retained line/)
      await initial.reader.cancel()
      const repeated = await open(2)
      assert.equal(repeated.first.sequence, 2)
      assert.equal(repeated.first.entries.length, 0)
      await sails.models.teammembership
        .updateOne({ user: user.id, team: user.team })
        .set({ status: 'invited' })
      f.bridge.record('log', {
        name: f.job.name,
        runId: admitted.data.run.runId,
        runtimeId: f.info.runtimeId,
        sequence: 3,
        logs: { stdout: 'MUST NOT LEAK AFTER REVOCATION\n', stderr: '' }
      })
      const deadline = setTimeout(
        () => controllers.forEach((controller) => controller.abort()),
        5000
      )
      let tail = ''
      try {
        while (true) {
          const chunk = await repeated.reader.read()
          if (chunk.done) break
          tail += new TextDecoder().decode(chunk.value)
        }
      } finally {
        clearTimeout(deadline)
      }
      assert.equal(tail.includes('MUST NOT LEAK'), false)
      assert.equal(f.starts.length, 1)
      assert.equal(
        (
          await f.bridge.dispatch({
            command: 'run',
            appId: String(f.app.id),
            deploymentId: String(f.app.currentDeployment),
            runId: admitted.data.run.runId
          })
        ).run.state,
        'running'
      )
    } finally {
      controllers.forEach((controller) => controller.abort())
      f.restore()
    }
  }
)
