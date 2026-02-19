module.exports = {
  friendlyName: 'Stream update progress',

  description: 'SSE endpoint that streams self-update progress phases to the UI.',

  inputs: {},

  exits: {
    success: {
      description: 'SSE stream established.'
    }
  },

  fn: async function () {
    const req = this.req
    const res = this.res
    const CACHE_KEY = 'slipway_update_progress'

    const stream = res.sse()

    // Send initial state immediately
    const initial = await sails.cache.get(CACHE_KEY)
    stream.send(initial || { phase: 'idle', detail: null })

    let lastPhase = initial?.phase || 'idle'
    let lastUpdatedAt = initial?.updatedAt || 0

    const interval = setInterval(async () => {
      try {
        const progress = await sails.cache.get(CACHE_KEY)
        if (!progress) return

        // Only send when something changes
        if (progress.updatedAt !== lastUpdatedAt) {
          lastPhase = progress.phase
          lastUpdatedAt = progress.updatedAt
          stream.send(progress)
        }
      } catch {
        // Cache read failed — ignore
      }
    }, 1000)

    stream.onClose(() => {
      clearInterval(interval)
    })

    return stream.wait()
  }
}
