import { ref, provide, inject } from 'vue'

const SERVICE_ACTIONS_KEY = Symbol('serviceActions')

/**
 * Creates the service actions state (used in AppLayout)
 */
export function createServiceActions() {
  const actions = ref([])
  let actionId = 0

  function startAction({
    serviceName,
    serviceType,
    action,
    projectName,
    environmentName
  }) {
    const id = ++actionId
    actions.value.push({
      id,
      serviceName,
      serviceType,
      action, // 'starting' | 'stopping' | 'restarting'
      projectName,
      environmentName,
      status: 'in_progress',
      startedAt: Date.now()
    })
    return id
  }

  function completeAction(id, success = true) {
    const action = actions.value.find((a) => a.id === id)
    if (action) {
      action.status = success ? 'success' : 'failed'
      // Auto-dismiss after 4 seconds
      setTimeout(() => {
        dismissAction(id)
      }, 4000)
    }
  }

  function dismissAction(id) {
    actions.value = actions.value.filter((a) => a.id !== id)
  }

  return { actions, startAction, completeAction, dismissAction }
}

/**
 * Use service actions from any child component
 */
export function useServiceActions() {
  const injected = inject(SERVICE_ACTIONS_KEY, null)
  if (!injected) {
    // Return a no-op version if not provided (for safety)
    return {
      startAction: () => 0,
      completeAction: () => {},
      dismissAction: () => {}
    }
  }
  return injected
}

/**
 * Provide service actions to child components (call from AppLayout)
 */
export function provideServiceActions(serviceActions) {
  provide(SERVICE_ACTIONS_KEY, serviceActions)
}
