const activeDeployments = new Map()

function register(deploymentId) {
  const key = String(deploymentId)
  const controller = new AbortController()
  activeDeployments.set(key, controller)

  return {
    signal: controller.signal,
    abort(message) {
      abortController(controller, deploymentId, message)
    },
    release() {
      if (activeDeployments.get(key) === controller) {
        activeDeployments.delete(key)
      }
    }
  }
}

function request(deploymentId, message) {
  const controller = activeDeployments.get(String(deploymentId))
  if (!controller) return false

  abortController(controller, deploymentId, message)
  return true
}

function throwIfCancelled(signal, deploymentId) {
  if (!signal?.aborted) return
  throw cancellationError(signal, deploymentId)
}

function cancellationError(signal, deploymentId) {
  if (
    signal?.reason instanceof Error &&
    signal.reason.code === 'DEPLOYMENT_CANCELLED'
  ) {
    return signal.reason
  }

  const reason =
    signal?.reason instanceof Error
      ? signal.reason.message
      : typeof signal?.reason === 'string'
      ? signal.reason
      : null
  const error = new Error(
    reason || `Deployment ${deploymentId || ''} was cancelled.`.trim()
  )
  error.code = 'DEPLOYMENT_CANCELLED'
  return error
}

function isCancellationError(error) {
  return (
    error?.code === 'DEPLOYMENT_CANCELLED' ||
    error?.cause?.code === 'DEPLOYMENT_CANCELLED'
  )
}

function abortController(controller, deploymentId, message) {
  if (controller.signal.aborted) return

  const error = new Error(
    message || `Deployment ${deploymentId} was cancelled.`
  )
  error.code = 'DEPLOYMENT_CANCELLED'
  controller.abort(error)
}

module.exports = {
  register,
  request,
  throwIfCancelled,
  cancellationError,
  isCancellationError
}
