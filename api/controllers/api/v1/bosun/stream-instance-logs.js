/**
 * stream-instance-logs.js
 *
 * SSE endpoint that streams live Slipway instance logs via `docker logs --follow`.
 * Same pattern as stream-container-logs.js but targets the fixed `slipway` container.
 */

const { spawn } = require('child_process')

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
    const args = ['logs', '--follow', '--tail', String(tail), '--timestamps', containerName]

    const docker = spawn(dockerPath, args)

    // Track whether we ever received real log output from the container.
    // If docker closes before any stdout, the container doesn't exist (local dev).
    let stdoutReceived = false

    function onData(data) {
      const lines = data.toString().split('\n')
      for (const line of lines) {
        if (line.length > 0) stream.send({ log: line })
      }
    }

    docker.stdout.on('data', (data) => {
      stdoutReceived = true
      onData(data)
    })

    // Buffer stderr until we know the container exists.
    // docker logs sends container stderr here during normal operation,
    // but also sends its own errors (e.g. "No such container") here.
    docker.stderr.on('data', (data) => {
      if (stdoutReceived) {
        // Container is running — this is real container stderr
        onData(data)
      }
      // Otherwise swallow — we'll send a friendly error on close
    })

    docker.on('error', (err) => {
      sails.log.error(`[stream-instance-logs] Docker spawn error: ${err.message}`)
      stream.send({ error: 'Instance logs are available when running in Docker' })
      stream.close()
    })

    docker.on('close', (code, signal) => {
      sails.log.debug(`[stream-instance-logs] Docker process closed with code: ${code}, signal: ${signal}`)
      if (code !== 0 && !stdoutReceived) {
        // Docker couldn't find the container — likely running outside Docker (local dev)
        stream.send({ error: 'Instance logs are available when running in Docker' })
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
