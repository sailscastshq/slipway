const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { test } = require('sounding')
const {
  worldFor,
  residentFixture
} = require('../../support/quest-resident-fixture')

test(
  'Quest app-scoped live stream preserves the selected non-default app',
  { transport: 'http', world: worldFor('quest-app-stream') },
  async (context) => {
    const { sails, world } = context
    const f = await residentFixture(context, 'quest-app-stream')
    try {
      await sails.models.app
        .updateOne({ id: f.app.id })
        .set({ isDefault: false })
      await world.create('app').with({
        environment: f.app.environment,
        slug: 'primary',
        isDefault: true,
        status: 'stopped'
      })
      const base = `/api/v1/projects/quest-app-stream/environments/production/apps/${f.app.slug}/quest`
      // Read the real HTTP event stream with a disposable local test token.
      const token = crypto.randomBytes(32).toString('hex')
      await sails.models.clitoken.create({
        user: world.current.users.genesisUser.id,
        token: crypto.createHash('sha256').update(token).digest('hex')
      })
      const controller = new AbortController()
      const deadline = setTimeout(() => controller.abort(), 5000)
      try {
        const address = sails.hooks.http.server.address()
        const response = await fetch(
          `http://127.0.0.1:${address.port}${base}/stream`,
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
        const data = text.split('\n').find((line) => line.startsWith('data:'))
        assert.equal(JSON.parse(data.slice(5)).workspace.target.appId, f.app.id)
        await reader.cancel()
      } finally {
        clearTimeout(deadline)
        controller.abort()
      }
    } finally {
      f.restore()
    }
  }
)
