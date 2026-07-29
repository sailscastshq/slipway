const activeExecutions = new Map()

function register({ executionId, userId }) {
  const key = String(executionId)
  if (activeExecutions.has(key)) {
    const error = new Error('A Helm execution with this ID is already active.')
    error.code = 'HELM_EXECUTION_EXISTS'
    throw error
  }

  const controller = new AbortController()
  let markCompleted
  const completed = new Promise((resolve) => {
    markCompleted = resolve
  })
  const execution = {
    completed,
    controller,
    userId: String(userId)
  }
  activeExecutions.set(key, execution)

  return {
    signal: controller.signal,
    abort(message) {
      abortExecution(controller, message)
    },
    release() {
      if (activeExecutions.get(key) === execution) {
        activeExecutions.delete(key)
      }
      markCompleted()
    }
  }
}

async function cancel({ executionId, userId, message }) {
  const execution = activeExecutions.get(String(executionId))
  if (!execution || execution.userId !== String(userId)) return false

  abortExecution(execution.controller, message)
  await execution.completed
  return true
}

function abortExecution(controller, message) {
  if (controller.signal.aborted) return

  const error = new Error(message || 'Helm execution was cancelled.')
  error.name = 'CancelledError'
  error.code = 'HELM_CANCELLED'
  controller.abort(error)
}

module.exports = {
  cancel,
  register
}
