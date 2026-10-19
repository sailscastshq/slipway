const { test } = require('node:test')
const assert = require('node:assert/strict')
const recovery = require('../../../api/lib/deployment-recovery')
const image = (n) => 'sha256:' + String(n).padStart(64, '0')
const release = (n, imageNumber = n) => ({
  deploymentId: String(n),
  imageId: image(imageNumber),
  promotedAt: n * 1000,
  compatibility: 'schema-1'
})
const app = { id: 1, environment: 2, currentDeployment: 1 }

test('healthy promotion retains one distinct predecessor, failed attempts do not advance it, and rollback rejects displaced image', () => {
  const a = recovery.advance(app, null, release(1))
  const c = recovery.advance({ ...app, currentDeployment: 1 }, a, release(3))
  assert.equal(c.current.deploymentId, '3')
  assert.equal(c.previous.deploymentId, '1')
  // Failed B has no successful cutover and therefore no advance/write.
  assert.deepEqual(recovery.parse(JSON.stringify(c), app).previous, release(1))
  const duplicate = recovery.advance(app, c, release(4, 3))
  assert.equal(duplicate.previous.deploymentId, '1')
  const rollback = recovery.advance(app, duplicate, release(5, 1), 'rollback')
  assert.equal(rollback.current.imageId, image(1))
  assert.equal(rollback.previous, null)
  assert.deepEqual(rollback.rejectedImages, [image(3)])
  assert.throws(
    () => recovery.advance(app, rollback, release(6, 3), 'rollback'),
    /no longer/
  )
  const redeploy = recovery.advance(app, rollback, release(7))
  assert.equal(redeploy.previous.imageId, image(1))
  const again = recovery.advance(app, redeploy, release(8, 1), 'rollback')
  assert.deepEqual(again.rejectedImages, [image(3), image(7)])
})

test('recovery state rejects wrong app/environment, invalid identity and a current or revoked target', () => {
  const current = recovery.advance(app, null, release(1))
  for (const bad of [
    { ...current, appId: '7' },
    { ...current, environmentId: '7' },
    { ...current, current: { ...release(1), imageId: 'mutable:latest' } },
    { ...current, previous: release(2, 1) },
    { ...current, previous: release(2), rejectedImages: [image(2)] }
  ])
    assert.throws(() => recovery.parse(bad, app))
})
