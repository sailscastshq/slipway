const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  receiptImageId,
  validPromotion,
  verifyBinding
} = require('../../../api/lib/legacy-deployment-artifact')
const image = 'sha256:' + '1'.repeat(64)
const tag = 'slipway/project-production-web:7'
const receipt = `#12 writing image ${image} done\n#12 naming to docker.io/${tag} done\n`
test('only a full completed export receipt naming the exact deployment proves a legacy image', () => {
  assert.equal(receiptImageId(receipt, tag), image)
  assert.equal(
    receiptImageId(receipt.replaceAll('#12', '2026-10-20T10:00:00Z #12'), tag),
    image
  )
  for (const text of [
    image,
    `#12 0.1 writing image ${image} done\n#12 naming to ${tag} done`,
    receipt.replace('done', ''),
    receipt.replace(
      'naming to docker.io/' + tag,
      'naming to docker.io/other:7'
    ),
    receipt.replace('#12 naming', '#13 naming'),
    receipt + `#12 writing image sha256:${'2'.repeat(64)} done\n`
  ])
    assert.equal(receiptImageId(text, tag), null)
})
test('binding requires successful same-app/environment provenance and unchanged receipt identity', () => {
  const app = { id: 1, environment: 2, currentDeployment: 9, imageId: null }
  const deployment = {
    id: 7,
    app: 1,
    environment: 2,
    status: 'stopped',
    startedAt: 100,
    finishedAt: 200,
    imageName: tag,
    buildLogs: receipt
  }
  const release = {
    deploymentId: '7',
    imageId: image,
    promotedAt: 200,
    legacyImageName: tag
  }
  assert.equal(verifyBinding(deployment, release, app), true)
  assert.equal(
    verifyBinding(
      { ...deployment, buildLogs: 'mutable tag only' },
      release,
      app
    ),
    false
  )
  for (const changed of [
    { app: 99 },
    { environment: 99 },
    { status: 'failed' },
    { finishedAt: null },
    { startedAt: null }
  ])
    assert.equal(validPromotion({ ...deployment, ...changed }, app), false)
  assert.equal(
    verifyBinding(
      deployment,
      { ...release, imageId: 'sha256:' + '2'.repeat(64) },
      app
    ),
    false
  )
})
