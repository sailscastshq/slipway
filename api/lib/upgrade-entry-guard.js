const { status } = require('./upgrade-coordinator')

// A normal entrypoint checks compatibility read-only. It cannot initialize,
// adopt, repair, resume or execute migrations. Activation waits for the complete
// fresh/legacy launch protocol; all secondary entrypoints must use this guard.
module.exports = function assertUpgradeReady({
  filename,
  instanceId,
  version,
  image,
  manifestHash
}) {
  let receipt
  try {
    receipt = status(filename)
  } catch (_) {
    return unavailable()
  }
  if (
    !instanceId ||
    !version ||
    !image ||
    !manifestHash ||
    receipt.instanceId !== instanceId ||
    receipt.version !== version ||
    receipt.image !== image ||
    receipt.manifestHash !== manifestHash ||
    receipt.phase !== 'completed' ||
    receipt.pending.length ||
    !receipt.reconciled
  )
    return unavailable()
  return { verified: true, runId: receipt.id, version, image, manifestHash }
}
function unavailable() {
  const error = new Error(
    'This instance has no complete compatible upgrade checkpoint. Use the coordinator recovery path before starting application jobs.'
  )
  error.code = 'upgradeNotReady'
  throw error
}
