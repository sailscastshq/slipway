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
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    })

    // Spawn `docker logs --follow` as a child process
    const args = ['logs', '--follow', '--tail', String(tail), '--timestamps', app.containerName]
    const docker = spawn('docker', args)

    function sendLine(line) {
      if (res.writableEnded) return
      res.write(`data: ${JSON.stringify({ log: line })}\n\n`)
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
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`)
        res.end()
      }
    })

    docker.on('close', () => {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ closed: true })}\n\n`)
        res.end()
      }
    })

    // Return a promise that prevents Sails from calling res.end() prematurely
    return new Promise((resolve) => {
      req.on('close', () => {
        docker.kill()
        resolve()
      })
    })
  }
}
