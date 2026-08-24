import { provide, inject } from 'vue'

const SERVICE_ACTIONS_KEY = Symbol('serviceActions')
const OPERATIONAL_TOAST_CLASS =
  'block overflow-visible bg-transparent p-0 shadow-none ring-0 dark:bg-transparent'

function toastId(id) {
  return `service-action-${id}`
}

/**
 * Creates the service actions state (used in AppLayout)
 */
export function createServiceActions(toast) {
  let actionId = 0

  function startAction({
    serviceName,
    serviceType,
    action,
    projectName,
    environmentName
  }) {
    const id = ++actionId
    const actionState = {
      id,
      serviceName,
      serviceType,
      action, // 'starting' | 'stopping' | 'restarting'
      projectName,
      environmentName,
      status: 'in_progress',
      startedAt: Date.now()
    }

    toast({
      id: toastId(id),
      kind: 'service-action',
      action: actionState,
      class: OPERATIONAL_TOAST_CLASS,
      dismissible: false,
      duration: false
    })
    return id
  }

  function completeAction(id, success = true) {
    const item = toast
      .getSnapshot()
      .find((candidate) => candidate.id === toastId(id))
    if (!item) return

    toast.update(toastId(id), {
      action: {
        ...item.action,
        status: success ? 'success' : 'failed'
      },
      duration: 4000
    })
  }

  function dismissAction(id) {
    toast.dismiss(toastId(id))
  }

  return { startAction, completeAction, dismissAction }
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
