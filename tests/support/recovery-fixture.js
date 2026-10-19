const recovery = require('../../api/lib/deployment-recovery')
const image = (n) => 'sha256:' + String(n).padStart(64, '0')
async function prepare({ sails, world, compatibility = null, legacy = false }) {
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
        imageId: image(2),
        promotedAt: current.finishedAt,
        compatibility
      },
      previous: {
        deploymentId: String(previous.id),
        imageId: image(1),
        promotedAt: previous.finishedAt,
        compatibility
      }
    },
    live
  )
  if (!legacy)
    await sails.models.setting.create({
      key: recovery.key(app.id),
      value: JSON.stringify(state)
    })
  else {
    for (const [deployment, number] of [
      [previous, 1],
      [current, 2]
    ]) {
      const imageName = await sails.models.app.generateImageName(
        environment.id,
        String(deployment.id),
        app.slug
      )
      const buildLogs = `#12 writing image ${image(
        number
      )} done\n#12 naming to docker.io/${imageName} done\n`
      Object.assign(
        deployment,
        await sails.models.deployment
          .updateOne({ id: deployment.id })
          .set({ imageId: null, imageName, buildLogs })
      )
    }
    Object.assign(
      live,
      await sails.models.app
        .updateOne({ id: app.id })
        .set({ imageId: null, imageName: current.imageName })
    )
  }

  const original = sails.helpers.docker.inspectDeploymentImage
  const artifacts = new Map([
    [image(1), compatibility],
    [image(2), compatibility]
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
