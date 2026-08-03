module.exports = function defineBridgeRuntimeHook(sails) {
  return {
    initialize: async function () {
      sails.after('hook:orm:loaded', () => {
        warmRunningBridgeApps().catch((error) => {
          sails.log.warn(
            `Bridge: Could not warm running app runtimes: ${error.message}`
          )
        })
      })
    }
  }

  async function warmRunningBridgeApps() {
    const apps = await App.find({
      bridgeEnabled: true,
      status: 'running'
    }).select(['id', 'containerName'])
    const candidates = apps.filter((app) => app.containerName)

    for (let index = 0; index < candidates.length; index += 2) {
      const batch = candidates.slice(index, index + 2)
      await Promise.all(batch.map(warmApp))
    }
  }

  async function warmApp(app) {
    try {
      await sails.helpers.bridge.warmRuntime.with({
        containerName: app.containerName
      })
      sails.log.verbose(
        `Bridge: Warm runtime ready for app ${app.id} (${app.containerName}).`
      )
    } catch (error) {
      sails.log.warn(
        `Bridge: Runtime warmup failed for app ${app.id} (${app.containerName}): ${error.message}`
      )
    }
  }
}
