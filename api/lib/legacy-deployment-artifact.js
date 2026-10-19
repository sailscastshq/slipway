const { IMAGE_ID, id } = require('./deployment-recovery')
// Parse only completed Docker export receipts, not arbitrary sha256 strings or
// command output. The same export step must also name this exact deployment tag.
function receiptImageId(logs, imageName) {
  if (typeof logs !== 'string' || Buffer.byteLength(logs) > 4 * 1024 * 1024)
    return null
  const writes = new Map(),
    names = new Set()
  for (const original of logs.split('\n')) {
    const line = original
      .replace(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z\s+/, '')
      .trimEnd()
    const write =
      /^#(\d+) (?:writing image|exporting config) (sha256:[a-f0-9]{64}) done$/.exec(
        line
      )
    if (write) {
      const values = writes.get(write[1]) || new Set()
      values.add(write[2])
      writes.set(write[1], values)
    }
    const name = /^#(\d+) naming to (\S+) done$/.exec(line)
    if (name && [imageName, `docker.io/${imageName}`].includes(name[2]))
      names.add(name[1])
  }
  const identities = new Set(
    [...names].flatMap((step) => [...(writes.get(step) || [])])
  )
  return identities.size === 1 ? [...identities][0] : null
}
function validPromotion(deployment, app) {
  return (
    deployment &&
    id(deployment.app) === id(app.id) &&
    id(deployment.environment) === id(app.environment) &&
    ['running', 'stopped'].includes(deployment.status) &&
    Number.isFinite(deployment.startedAt) &&
    deployment.startedAt > 0 &&
    Number.isFinite(deployment.finishedAt) &&
    deployment.finishedAt >= deployment.startedAt
  )
}
function verifyBinding(deployment, release, app) {
  if (
    !validPromotion(deployment, app) ||
    id(deployment.id) !== id(release.deploymentId) ||
    deployment.imageName !== release.legacyImageName ||
    deployment.finishedAt !== release.promotedAt
  )
    return false
  if (deployment.imageId) return deployment.imageId === release.imageId
  if (id(app.currentDeployment) === id(deployment.id) && app.imageId)
    return app.imageId === release.imageId
  return (
    receiptImageId(deployment.buildLogs, deployment.imageName) ===
    release.imageId
  )
}
module.exports = { receiptImageId, validPromotion, verifyBinding, IMAGE_ID }
