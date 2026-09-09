const { test } = require('sounding')
const assert = require('node:assert/strict')
test(
  'custom service schema upgrades an existing database without changing managed services',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'custom-schema' } }
    }
  },
  async ({ sails, world }) => {
    const service = await world.create('service').with({
      environment: world.current.environments.production.id,
      name: 'existing-db',
      status: 'running',
      version: '16',
      imageReference: 'sha256:existing'
    })
    const db = sails.getDatastore()
    await db.sendNativeQuery('DROP TABLE custom_service_reviews')
    await db.sendNativeQuery(
      'ALTER TABLE services DROP COLUMN custom_definition'
    )
    await db.sendNativeQuery('ALTER TABLE services DROP COLUMN custom_state')
    await sails.helpers.service.ensureVersionSchema()
    await sails.helpers.service.ensureVersionSchema()
    const retained = await sails.models.service.findOne({ id: service.id })
    assert.equal(retained.status, 'running')
    assert.equal(retained.version, '16')
    assert.equal(retained.imageReference, 'sha256:existing')
    assert.deepEqual(retained.customState, {})
    const review = await sails.models.customservicereview
      .create({
        token: require('node:crypto').randomUUID(),
        actor: world.current.users.genesisUser.id,
        environment: world.current.environments.production.id,
        definition: { env: { TOKEN: 'encrypted-schema-fixture' } },
        imageReference: 'sha256:fixture',
        expiresAt: Date.now() + 10000
      })
      .fetch()
    assert.equal(
      (
        await sails.models.customservicereview.findOne({ id: review.id })
      ).definition.includes('encrypted-schema-fixture'),
      false
    )
    assert.equal(
      (
        await sails.models.customservicereview
          .findOne({ id: review.id })
          .decrypt()
      ).definition.env.TOKEN,
      'encrypted-schema-fixture'
    )
  }
)
