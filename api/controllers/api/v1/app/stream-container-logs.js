/**
 * stream-container-logs.js
 *
 * SSE endpoint that streams live container logs via `docker logs --follow`.
 * Unlike deployment logs (which poll the database), this pipes Docker's
 * log stream directly to the browser in real-time.
 */

const { spawn } = require('child_process')

module.exports = {
  friendlyName: 'Stream container logs',

  description: 'Server-Sent Events stream of live container output.',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true
    },
    environmentSlug: {
      type: 'string',
      required: true
    },
    tail: {
      type: 'number',
      defaultsTo: 200,
      description: 'Number of historical lines to send first'
    }
  },

  exits: {
    success: {
      description: 'SSE stream started.'
    },
    notFound: {
      statusCode: 404,
      description: 'App or container not found.'
    }
  },

  fn: async function ({ projectSlug, environmentSlug, tail }) {
    const req = this.req
    const res = this.res

    const user = await User.findOne({ id: req.session.userId }).populate('team')
    const project = await Project.findOne({ slug: projectSlug, team: user.team.id })
    if (!project) throw 'notFound'

    const environment = await Environment.findOne({ slug: environmentSlug, project: project.id })
    if (!environment) throw 'notFound'

    const app = await App.findOne({ environment: environment.id })
    if (!app || !app.containerName) throw 'notFound'

    // Commit SSE headers immediately so Sails cannot override them
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Content-Encoding': 'identity'
    })

    // Send an immediate test message to verify connection
    res.write(`data: ${JSON.stringify({ test: 'connection' })}\n\n`)
    sails.log.debug(`[stream-container-logs] Test message written`)

    // Track cleanup state to prevent double-cleanup race conditions
    let cleanedUp = false

    function cleanup() {
      if (cleanedUp) return
      cleanedUp = true
    }

    function safeWrite(data) {
      if (cleanedUp || res.writableEnded || res.destroyed) {
        sails.log.debug(`[stream-container-logs] safeWrite blocked: cleanedUp=${cleanedUp}, writableEnded=${res.writableEnded}, destroyed=${res.destroyed}`)
        return false
      }
      try {
        res.write(data)
        // Flush to prevent buffering
        if (res.flush) res.flush()
        return true
      } catch (err) {
        sails.log.error(`[stream-container-logs] safeWrite error: ${err.message}`)
        cleanup()
        return false
      }
    }

    // Spawn `docker logs --follow` as a child process
    const dockerPath = sails.config.docker?.binaryPath || 'docker'
    const args = ['logs', '--follow', '--tail', String(tail), '--timestamps', app.containerName]

    sails.log.debug(`[stream-container-logs] Starting docker logs for container: ${app.containerName}`)
    sails.log.debug(`[stream-container-logs] Command: ${dockerPath} ${args.join(' ')}`)

    // Send initial connected message
    const initSent = safeWrite(`data: ${JSON.stringify({ connected: true, container: app.containerName })}\n\n`)
    sails.log.debug(`[stream-container-logs] Initial message sent: ${initSent}`)

    sails.log.debug(`[stream-container-logs] Spawning docker process...`)
    const docker = spawn(dockerPath, args)

    function sendLine(line) {
      const sent = safeWrite(`data: ${JSON.stringify({ log: line })}\n\n`)
      if (!sent) {
        sails.log.debug(`[stream-container-logs] Failed to send line, connection may be closed`)
      }
    }

    function onData(data) {
      const text = data.toString()
      sails.log.debug(`[stream-container-logs] Received ${text.length} bytes from docker`)
      const lines = text.split('\n')
      for (const line of lines) {
        if (line.length > 0) sendLine(line)
      }
    }

    docker.stdout.on('data', onData)
    docker.stderr.on('data', onData)

    docker.on('spawn', () => {
      sails.log.debug(`[stream-container-logs] Docker process spawned successfully`)
    })

    docker.on('error', (err) => {
      sails.log.error(`[stream-container-logs] Docker spawn error: ${err.message}`)
      if (safeWrite(`data: ${JSON.stringify({ error: err.message })}\n\n`)) {
        try { res.end() } catch (e) { /* ignore */ }
      }
      cleanup()
    })

    docker.on('close', (code, signal) => {
      sails.log.debug(`[stream-container-logs] Docker process closed with code: ${code}, signal: ${signal}`)
      if (safeWrite(`data: ${JSON.stringify({ closed: true })}\n\n`)) {
        try { res.end() } catch (e) { /* ignore */ }
      }
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
