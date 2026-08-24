/**
 * Track asynchronous application work that must finish before shutdown.
 *
 * Once draining begins, new work resolves to its shutdown fallback instead of
 * starting against resources that Sails is about to tear down.
 *
 * @returns {{
 *   run<T>(work: () => T | Promise<T>, fallback: T): Promise<T>,
 *   drain(): Promise<void>,
 *   readonly pending: number,
 *   readonly draining: boolean
 * }}
 */
module.exports = function createInFlightWork() {
  const active = new Set()
  const waiters = new Set()
  let draining = false

  function resolveWaitersWhenIdle() {
    if (!draining || active.size !== 0) {
      return
    }

    for (const resolve of waiters) {
      resolve()
    }
    waiters.clear()
  }

  return {
    async run(work, fallback) {
      if (draining) {
        return fallback
      }

      const pendingWork = Promise.resolve().then(work)
      active.add(pendingWork)

      try {
        return await pendingWork
      } finally {
        active.delete(pendingWork)
        resolveWaitersWhenIdle()
      }
    },

    drain() {
      draining = true

      if (active.size === 0) {
        return Promise.resolve()
      }

      return new Promise((resolve) => {
        waiters.add(resolve)
      })
    },

    get pending() {
      return active.size
    },

    get draining() {
      return draining
    }
  }
}
