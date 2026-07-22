const { Transform } = require('node:stream')

module.exports = function createByteLimitTransform({ maxBytes, label }) {
  let bytes = 0

  const transform = new Transform({
    transform(chunk, encoding, callback) {
      bytes += chunk.length

      if (bytes > maxBytes) {
        const error = new Error(
          `${label} exceeded the ${formatBytes(maxBytes)} limit.`
        )
        error.code = 'STREAM_SIZE_LIMIT'
        error.maxBytes = maxBytes
        error.bytes = bytes
        callback(error)
        return
      }

      callback(null, chunk)
    }
  })

  transform.getBytes = () => bytes
  return transform
}

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }

  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}
