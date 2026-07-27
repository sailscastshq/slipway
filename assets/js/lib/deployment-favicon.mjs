export const DEPLOYMENT_FAVICON_STATES = Object.freeze({
  idle: 'idle',
  deploying: 'deploying',
  success: 'success',
  failed: 'failed',
  cancelled: 'cancelled'
})

export const DEPLOYMENT_FAVICON_HREFS = Object.freeze({
  idle: '/images/favicon.svg',
  deploying: '/images/favicon-deploying.svg',
  success: '/images/favicon-success.svg',
  failed: '/images/favicon-failed.svg',
  cancelled: '/images/favicon-cancelled.svg'
})

export const DEPLOYMENT_FAVICON_TERMINAL_DURATIONS = Object.freeze({
  success: 10000,
  failed: 12000,
  cancelled: 12000
})

const ACTIVE_DEPLOYMENT_STATUSES = new Set([
  'pending',
  'building',
  'pushing',
  'deploying'
])

const TERMINAL_DEPLOYMENT_STATES = Object.freeze({
  running: DEPLOYMENT_FAVICON_STATES.success,
  failed: DEPLOYMENT_FAVICON_STATES.failed,
  cancelled: DEPLOYMENT_FAVICON_STATES.cancelled
})

const TERMINAL_STATE_PRIORITY = Object.freeze({
  success: 1,
  cancelled: 2,
  failed: 3
})

export function resolveDeploymentFaviconState({
  activeStatuses = [],
  terminalStates = []
} = {}) {
  if (activeStatuses.some((status) => isActiveDeploymentStatus(status))) {
    return DEPLOYMENT_FAVICON_STATES.deploying
  }

  return terminalStates.reduce(
    (highestPriorityState, state) =>
      (TERMINAL_STATE_PRIORITY[state] || 0) >
      (TERMINAL_STATE_PRIORITY[highestPriorityState] || 0)
        ? state
        : highestPriorityState,
    DEPLOYMENT_FAVICON_STATES.idle
  )
}

export function createDeploymentFaviconManager({
  documentRef = typeof document === 'undefined' ? null : document,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  terminalDurations = DEPLOYMENT_FAVICON_TERMINAL_DURATIONS
} = {}) {
  let iconLink = null
  let originalHref = null
  let activeDeployments = new Map()
  const terminalDeployments = new Map()
  const terminalTimers = new Map()

  function ensureIconLink() {
    if (!documentRef) return null
    if (iconLink) return iconLink

    iconLink = documentRef.querySelector('link[rel~="icon"]')
    if (!iconLink) {
      iconLink = documentRef.createElement('link')
      iconLink.setAttribute('rel', 'icon')
      iconLink.setAttribute('type', 'image/svg+xml')
      iconLink.setAttribute('sizes', 'any')
      documentRef.head.appendChild(iconLink)
    }

    originalHref =
      iconLink.getAttribute('href') || DEPLOYMENT_FAVICON_HREFS.idle

    return iconLink
  }

  function getState() {
    return resolveDeploymentFaviconState({
      activeStatuses: [...activeDeployments.values()],
      terminalStates: [...terminalDeployments.values()]
    })
  }

  function render() {
    const state = getState()
    const link = ensureIconLink()
    if (!link) return state

    const href =
      state === DEPLOYMENT_FAVICON_STATES.idle
        ? originalHref || DEPLOYMENT_FAVICON_HREFS.idle
        : DEPLOYMENT_FAVICON_HREFS[state]

    link.setAttribute('href', href)
    link.dataset.deploymentState = state

    return state
  }

  function replaceActiveDeployments(deployments = []) {
    activeDeployments = new Map(
      deployments
        .filter(
          ({ id, status }) =>
            isActiveDeploymentStatus(status) &&
            !terminalDeployments.has(String(id))
        )
        .map(({ id, status }) => [String(id), status])
    )

    return render()
  }

  function noteDeploymentStatus(deploymentId, status) {
    const id = String(deploymentId)

    if (isActiveDeploymentStatus(status)) {
      clearTerminalState(id)
      activeDeployments.set(id, status)
      return render()
    }

    const terminalState = TERMINAL_DEPLOYMENT_STATES[status]
    if (!terminalState) return getState()

    activeDeployments.delete(id)
    terminalDeployments.set(id, terminalState)
    scheduleTerminalReset(id, terminalState)

    return render()
  }

  function scheduleTerminalReset(deploymentId, terminalState) {
    clearTerminalTimer(deploymentId)

    const duration = terminalDurations[terminalState]
    if (!duration) {
      clearTerminalState(deploymentId)
      return
    }

    const timer = setTimeoutFn(() => {
      terminalTimers.delete(deploymentId)
      if (terminalDeployments.get(deploymentId) === terminalState) {
        terminalDeployments.delete(deploymentId)
      }
      render()
    }, duration)

    terminalTimers.set(deploymentId, timer)
  }

  function clearTerminalTimer(deploymentId) {
    const timer = terminalTimers.get(deploymentId)
    if (timer === undefined) return

    clearTimeoutFn(timer)
    terminalTimers.delete(deploymentId)
  }

  function clearTerminalState(deploymentId) {
    clearTerminalTimer(deploymentId)
    terminalDeployments.delete(deploymentId)
  }

  function clearTerminalStates() {
    terminalDeployments.clear()

    for (const timer of terminalTimers.values()) {
      clearTimeoutFn(timer)
    }
    terminalTimers.clear()
  }

  function acknowledgeTerminalStates() {
    clearTerminalStates()

    return render()
  }

  function reset() {
    activeDeployments.clear()
    clearTerminalStates()

    return render()
  }

  function destroy() {
    reset()
    iconLink = null
    originalHref = null
  }

  render()

  return {
    acknowledgeTerminalStates,
    destroy,
    getState,
    noteDeploymentStatus,
    replaceActiveDeployments,
    reset
  }
}

function isActiveDeploymentStatus(status) {
  return ACTIVE_DEPLOYMENT_STATUSES.has(status)
}
