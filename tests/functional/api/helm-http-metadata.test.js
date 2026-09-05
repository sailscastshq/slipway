const { test } = require('sounding')

test(
  'Bosun Helm introspects its live Sails app without returning config values',
  {
    transport: 'http',
    world: {
      name: 'configured-slipway'
    }
  },
  async ({ sails, world, request, expect }) => {
    const secret = 'helm-completion-value-must-stay-server-side'
    sails.config.custom.helmCompletionTestSecret = secret

    try {
      // This metadata exceeds the virtual transport's 64 KiB backpressure boundary.
      // Exercise the real HTTP response and token authentication instead.
      const crypto = require('node:crypto')
      const raw = crypto.randomBytes(32).toString('hex')
      await sails.models.clitoken.create({
        user: world.current.users.genesisUser.id,
        token: crypto.createHash('sha256').update(raw).digest('hex')
      })
      const response = await request
        .withHeaders({ authorization: `Bearer sl_${raw}` })
        .get('/api/v1/bosun/helm/completions')

      expect(response).toHaveStatus(200)
      expect(response.header('cache-control')).toMatch('private')
      expect(response.header('cache-control')).toMatch('no-store')
      expect(response).toHaveJsonPath('available', true)
      expect(response).toHaveJsonPath('version', 1)
      const userModel = response.data.models.find(
        (model) => model.identity === 'user'
      )
      expect(userModel.globalId).toBe('User')
      expect(
        userModel.attributes.some((attribute) => attribute.name === 'email')
      ).toBe(true)
      expect(response.data.helpers.length > 0).toBe(true)
      expect(
        response.data.config.some(
          (entry) => entry.path === 'custom.helmCompletionTestSecret'
        )
      ).toBe(true)
      expect(JSON.stringify(response.data).includes(secret)).toBe(false)
    } finally {
      delete sails.config.custom.helmCompletionTestSecret
    }
  }
)
