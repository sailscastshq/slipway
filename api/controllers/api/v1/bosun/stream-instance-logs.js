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

    // Commit SSE headers immediately so Sails cannot override them
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Content-Encoding': 'identity'
    })

    // Track cleanup state to prevent double-cleanup race conditions
    let cleanedUp = false

    function cleanup() {
      if (cleanedUp) return
      cleanedUp = true
    }

    function safeWrite(data) {
      if (cleanedUp || res.writableEnded || res.destroyed) return false
      try {
        res.write(data)
        if (res.flush) res.flush()
        return true
      } catch (err) {
        sails.log.error(`[stream-instance-logs] safeWrite error: ${err.message}`)
        cleanup()
        return false
      }
    }

    // Spawn `docker logs --follow` as a child process
    const dockerPath = sails.config.docker?.binaryPath || 'docker'
    const args = ['logs', '--follow', '--tail', String(tail), '--timestamps', containerName]

    // Send initial connected message
    safeWrite(`data: ${JSON.stringify({ connected: true, container: containerName })}\n\n`)

    const docker = spawn(dockerPath, args)

    // Track whether we ever received real log output from the container.
    // If docker closes before any stdout, the container doesn't exist (local dev).
    let stdoutReceived = false

    function sendLine(line) {
      safeWrite(`data: ${JSON.stringify({ log: line })}\n\n`)
    }

    function onData(data) {
      const text = data.toString()
      const lines = text.split('\n')
      for (const line of lines) {
        if (line.length > 0) sendLine(line)
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
      if (safeWrite(`data: ${JSON.stringify({ error: 'Instance logs are available when running in Docker' })}\n\n`)) {
        try { res.end() } catch (e) { /* ignore */ }
      }
      cleanup()
    })

    docker.on('close', (code, signal) => {
      sails.log.debug(`[stream-instance-logs] Docker process closed with code: ${code}, signal: ${signal}`)
      if (code !== 0 && !stdoutReceived) {
        // Docker couldn't find the container — likely running outside Docker (local dev)
        safeWrite(`data: ${JSON.stringify({ error: 'Instance logs are available when running in Docker' })}\n\n`)
      } else {
        safeWrite(`data: ${JSON.stringify({ closed: true })}\n\n`)
      }
      try { res.end() } catch (e) { /* ignore */ }
      cleanup()
    })

    // Handle response errors (e.g., client disconnect during gzip)
    res.on('error', () => {
      cleanup()
      docker.kill()
    })

    // Return a promise that prevents Sails from calling res.end() prematurely
    return new Promise((resolve) => {
      req.on('close', () => {
        cleanup()
        docker.kill()
        resolve()
      })
    })
  }
}
