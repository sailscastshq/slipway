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

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    })

    // Send initial state immediately
    const initial = await sails.cache.get(CACHE_KEY)
    res.write(`data: ${JSON.stringify(initial || { phase: 'idle', detail: null })}\n\n`)

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
          res.write(`data: ${JSON.stringify(progress)}\n\n`)
        }
      } catch {
        // Cache read failed — ignore
      }
    }, 1000)

    req.on('close', () => {
      clearInterval(interval)
    })

    // Keep the connection open
    return new Promise(() => {})
  }
}
