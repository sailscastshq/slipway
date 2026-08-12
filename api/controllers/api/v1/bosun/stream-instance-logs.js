/**
 * stream-instance-logs.js
 *
 * SSE endpoint that streams live Slipway instance logs via `docker logs --follow`.
 * Same pattern as stream-container-logs.js but targets the fixed `slipway` container.
 */

const { spawn } = require('child_process')
const createLineFramer = require('../../../../lib/create-line-framer')

module.exports = {
  friendlyName: 'Stream instance logs',

  description: 'Server-Sent Events stream of the Slipway container output.',

  inputs: {
    tail: {
      type: 'number',
      defaultsTo: 200,
      description: 'Number of historical lines to send first'
    }
  },

  exits: {
    success: {
      description: 'SSE stream started.'
    }
  },

  fn: async function ({ tail }) {
    const req = this.req
    const res = this.res

    const containerName = 'slipway'

    const stream = res.sse()

    // Send initial connected message
    stream.send({ connected: true, container: containerName })

    // Spawn `docker logs --follow` as a child process
    const dockerPath = sails.config.docker?.binaryPath || 'docker'
    const args = [
      'logs',
      '--follow',
      '--tail',
      String(tail),
      '--timestamps',
      containerName
    ]

    const docker = spawn(dockerPath, args)

    // Docker preserves the container's stdout/stderr split. A healthy Node
    // process can legitimately write only to stderr for long stretches, so
    // both streams must be delivered immediately. Waiting for stdout makes a
    // live EventSource look connected while its useful output is held forever.
    const stdoutLines = createLineFramer({
      onLine(line) {
        stream.send({ log: line })
      }
    })
    const stderrLines = createLineFramer({
      onLine(line) {
        stream.send({ log: line })
      }
    })

    docker.stdout.on('data', (data) => stdoutLines.write(data))

    docker.stderr.on('data', (data) => {
      stderrLines.write(data)
    })

    docker.on('error', (err) => {
      sails.log.error(
        `[stream-instance-logs] Docker spawn error: ${err.message}`
      )
      stream.send({
        error: 'Instance logs are available when running in Docker'
      })
      stream.close()
    })

    docker.on('close', (code, signal) => {
      stdoutLines.end()
      stderrLines.end()
      sails.log.debug(
        `[stream-instance-logs] Docker process closed with code: ${code}, signal: ${signal}`
      )
      if (code !== 0) {
        // Preserve Docker's output above, then add a useful product-level
        // explanation instead of treating a failed command as a clean close.
        stream.send({
          error: 'Instance logs are available when running in Docker'
        })
      } else {
        stream.send({ closed: true })
      }
      stream.close()
    })

    stream.onClose(() => {
      docker.kill()
    })

    return stream.wait()
  }
}
