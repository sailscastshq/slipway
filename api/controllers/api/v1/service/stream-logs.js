/**
 * stream-logs.js
 *
 * SSE endpoint that streams live service container logs via `docker logs --follow`.
 */

const { spawn } = require('child_process')

module.exports = {
  friendlyName: 'Stream service logs',

  description: 'Server-Sent Events stream of live service container output.',

  inputs: {
    serviceId: {
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
      description: 'Service or container not found.'
    }
  },

  fn: async function ({ serviceId, tail }) {
    const req = this.req
    const res = this.res

    const user = await User.findOne({ id: req.session.userId }).populate('team')
    if (!user) throw 'notFound'

    const service = await Service.findOne({ id: serviceId }).populate('environment')
    if (!service) throw 'notFound'

    const environment = await Environment.findOne({ id: service.environment.id }).populate('project')
    if (!environment) throw 'notFound'

    const project = await Project.findOne({ id: environment.project.id })
    if (!project || project.team !== user.team.id) throw 'notFound'

    if (!service.containerName) throw 'notFound'

    // Commit SSE headers immediately so Sails cannot override them
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
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
        return true
      } catch (err) {
        cleanup()
        return false
      }
    }

    // Spawn `docker logs --follow` as a child process
    const dockerPath = sails.config.docker?.binaryPath || 'docker'
    const args = ['logs', '--follow', '--tail', String(tail), '--timestamps', service.containerName]
    const docker = spawn(dockerPath, args)

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

    docker.stdout.on('data', onData)
    docker.stderr.on('data', onData)

    docker.on('error', (err) => {
      if (safeWrite(`data: ${JSON.stringify({ error: err.message })}\n\n`)) {
        try { res.end() } catch (e) { /* ignore */ }
      }
      cleanup()
    })

    docker.on('close', () => {
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
