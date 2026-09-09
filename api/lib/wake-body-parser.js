const skipper = require('skipper')
const { LIMITS } = require('./wake-ingest')
// Keep the existing parser unchanged for every other application route.
module.exports = function withWakeBodyLimit(defaultParser) {
  const parser = skipper({ limit: LIMITS.bytes })
  return function parseBody(req, res, next) {
    const pathname = String(req.url || '').split('?')[0]
    if (!/^\/api\/v1\/wake\/(ingest|register)\/?$/i.test(pathname))
      return defaultParser(req, res, next)
    if (
      !/^application\/json(?:\s*;|$)/i.test(
        String(req.headers['content-type'] || '')
      )
    ) {
      return res
        .status(415)
        .json({ error: 'Wake runtime requests require JSON.' })
    }
    return parser(req, res, (error) => {
      if (error)
        return res
          .status(error.status === 413 ? 413 : 400)
          .json({ error: 'Invalid Wake payload.' })
      next()
    })
  }
}
