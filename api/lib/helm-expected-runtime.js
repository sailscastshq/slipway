/** Resolve the current app/deployment identity without exposing secrets. */
module.exports = async function expectedHelmRuntime(
  app,
  findConnection = (appId) => TelemetryConnection.findOne({ app: appId })
) {
  const deploymentId = String(
    app.currentDeployment?.id || app.currentDeployment || ''
  )
  const appId = String(app.id)
  const connection = await findConnection(appId)
  const version = String(connection?.hookVersion || '').match(
    /^(\d+)\.(\d+)\.(\d+)/
  )
  const supportsContract =
    version &&
    (Number(version[1]) > 0 ||
      Number(version[2]) > 0 ||
      Number(version[3]) >= 11)
  return {
    appId,
    deploymentId,
    required: Boolean(
      supportsContract && String(connection.deployment) === deploymentId
    )
  }
}
