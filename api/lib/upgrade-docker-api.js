const http = require('node:http')
function failure() {
  return Object.assign(
    new Error('Docker upgrade action could not be confirmed.'),
    { code: 'upgradeDockerFailed' }
  )
}
// Structured Unix-socket bodies preserve existing secrets without placing
// environment values in process arguments or echoing Docker response bodies.
module.exports = function createDockerClient(
  socketPath = '/var/run/docker.sock'
) {
  return function request(method, route, body, timeoutMs = 30000) {
    if (
      !['GET', 'POST', 'DELETE'].includes(method) ||
      !route.startsWith('/') ||
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs <= 0
    )
      return Promise.reject(failure())
    let encoded
    try {
      encoded = body === undefined ? null : Buffer.from(JSON.stringify(body))
    } catch {
      return Promise.reject(failure())
    }
    if (encoded?.length > 1024 * 1024) return Promise.reject(failure())
    return new Promise((resolve, reject) => {
      const call = http.request({
        socketPath,
        path: '/v1.47' + route,
        method,
        headers: encoded
          ? {
              'Content-Type': 'application/json',
              'Content-Length': encoded.length
            }
          : {}
      })
      const timer = setTimeout(() => call.destroy(failure()), timeoutMs)
      call.on('error', () => {
        clearTimeout(timer)
        reject(failure())
      })
      call.on('response', (response) => {
        const chunks = []
        let size = 0
        response.on('data', (chunk) => {
          size += chunk.length
          if (size > 2 * 1024 * 1024) call.destroy(failure())
          else chunks.push(chunk)
        })
        response.on('error', () => {
          clearTimeout(timer)
          reject(failure())
        })
        response.on('end', () => {
          clearTimeout(timer)
          if (response.statusCode < 200 || response.statusCode >= 300)
            return reject(failure())
          try {
            const text = Buffer.concat(chunks).toString()
            resolve(text ? JSON.parse(text) : null)
          } catch {
            reject(failure())
          }
        })
      })
      call.end(encoded)
    })
  }
}
