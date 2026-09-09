const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const execute = promisify(execFile)
const missing = (error) =>
  /No such (?:container|object)/i.test(error?.stderr || '')
module.exports = async function removeExternalClient(docker, name) {
  if (!/^slipway-pg-client-[a-f0-9-]{36}$/.test(name))
    throw new Error('Invalid external client cleanup reference.')
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await execute(docker, ['rm', '-f', name], {
        timeout: 5000,
        maxBuffer: 8192
      })
      return
    } catch (error) {
      if (missing(error)) return
      // --rm can be deleting the container concurrently. Confirm absence rather than assuming success.
      try {
        await execute(docker, ['inspect', '--format', '{{.Id}}', name], {
          timeout: 5000,
          maxBuffer: 8192
        })
      } catch (inspectError) {
        if (missing(inspectError)) return
      }
      if (attempt === 2) throw error
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
}
