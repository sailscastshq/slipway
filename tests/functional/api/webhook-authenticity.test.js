const { test } = require('sounding')
const crypto = require('node:crypto')

test(
  'HTTP webhook signatures preserve exact bytes and deliveries are idempotent',
  { transport: 'http', world: 'configured-slipway' },
  async ({ request, world, sails, expect }) => {
    const current = world.current
    const secret = 'webhook-test-secret'
    const project = await world.create('project').with({
      slug: 'webhook-bytes',
      team: current.teams.genesisTeam.id,
      createdBy: current.users.genesisUser.id,
      webhookSecret: secret
    })
    const provider = await world
      .create('gitprovider')
      .with({ team: current.teams.genesisTeam.id })
    await world.create('gitrepository').with({
      externalId: '3298',
      webhookSecret: secret,
      provider: provider.id
    })
    const raw =
      ' { "repository" : { "id" : 3298 }, "zen" : "Écrire et déployer 🚢" }\n'
    const signature =
      'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex')
    for (const [index, endpoint] of [
      '/webhook/github',
      `/api/v1/webhooks/github/${project.slug}`
    ].entries()) {
      const sender = request.withHeaders({
        'content-type': 'application/json',
        'x-github-event': 'ping',
        'x-github-delivery': `bytes-${index}`,
        'x-hub-signature-256': signature
      })
      expect(await sender.post(endpoint, raw)).toHaveStatus(200)
      const duplicate = await sender.post(endpoint, raw)
      expect(duplicate).toHaveStatus(200)
      expect(duplicate.data.duplicate).toBe(true)
      expect(
        await sender
          .withHeaders({ 'x-hub-signature-256': 'sha256=bad' })
          .post(endpoint, raw)
      ).toHaveStatus(403)
      expect(
        await sender.post(endpoint, JSON.stringify(JSON.parse(raw)))
      ).toHaveStatus(403)
      expect(
        await sender
          .withHeaders({ 'x-github-delivery': '' })
          .post(endpoint, raw)
      ).toHaveStatus(400)
      const responses = await Promise.all(
        [1, 2].map(() =>
          sender
            .withHeaders({ 'x-github-delivery': `concurrent-${index}` })
            .post(endpoint, raw)
        )
      )
      expect(
        responses.filter((response) => response.data.duplicate).length
      ).toBe(1)
    }
    expect(await sails.models.webhookdelivery.count()).toBe(4)
  }
)
