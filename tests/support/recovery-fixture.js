const recovery = require('../../api/lib/deployment-recovery')
const image = (n) => 'sha256:' + String(n).padStart(64, '0')
async function prepare({ sails, world }) {
  const environment = world.current.environments.production
  const app = world.current.apps.web
  const previous = await world.create('deployment').with({
    environment: environment.id,
    app: app.id,
    status: 'stopped',
    startedAt: Date.now() - 2000,
    imageName: `slipway/fixture:${Date.now()}`,
    imageId: image(1),
    finishedAt: Date.now() - 1000,
    gitCommit: 'a'.repeat(40),
    gitMessage: 'Previous healthy fixture release'
  })
  const current = await world.create('deployment').with({
    environment: environment.id,
    app: app.id,
    status: 'running',
    startedAt: Date.now() - 1000,
    imageName: `slipway/fixture:${Date.now() + 1}`,
    imageId: image(2),
    finishedAt: Date.now(),
    gitCommit: 'c'.repeat(40),
    gitMessage: 'Current healthy fixture release'
  })
  const live = await sails.models.app.updateOne({ id: app.id }).set({
    currentDeployment: current.id,
    imageId: current.imageId,
    imageName: current.imageName,
    containerName: 'safe-recovery-fixture',
    status: 'running'
  })
  const state = recovery.parse(
    {
      version: 1,
      appId: String(app.id),
      environmentId: String(environment.id),
      rejectedImages: [],
      current: {
        deploymentId: String(current.id),
        imageId: current.imageId,
        promotedAt: current.finishedAt,
        compatibility: 'schema-1'
      },
      previous: {
        deploymentId: String(previous.id),
        imageId: previous.imageId,
        promotedAt: previous.finishedAt,
        compatibility: 'schema-1'
      }
    },
    live
  )
  await sails.models.setting.create({
    key: recovery.key(app.id),
    value: JSON.stringify(state)
  })
  const original = sails.helpers.docker.inspectDeploymentImage
  const artifacts = new Map([
    [image(1), 'schema-1'],
    [image(2), 'schema-1']
  ])
  const inspect = async ({ imageReference }) => {
    if (!artifacts.has(imageReference))
      throw new Error('Safe fixture: local image unavailable')
    return {
      imageId: imageReference,
      compatibility: artifacts.get(imageReference),
      os: 'linux',
      architecture: 'amd64'
    }
  }
  inspect.with = inspect
  sails.helpers.docker.inspectDeploymentImage = inspect
  return {
    app: live,
    previous,
    current,
    environment,
    state,
    artifacts,
    restore() {
      sails.helpers.docker.inspectDeploymentImage = original
    }
  }
}
module.exports = { prepare, image }
