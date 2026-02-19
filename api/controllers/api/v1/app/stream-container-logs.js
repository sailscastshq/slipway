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
    },
    appSlug: {
      type: 'string',
      description: 'Target app slug (defaults to default app)'
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

  fn: async function ({ projectSlug, environmentSlug, tail, appSlug }) {
    const req = this.req
    const res = this.res

    const user = await User.findOne({ id: req.session.userId }).populate('team')
    const project = await Project.findOne({ slug: projectSlug, team: user.team.id })
    if (!project) throw 'notFound'

    const environment = await Environment.findOne({ slug: environmentSlug, project: project.id })
    if (!environment) throw 'notFound'

    const app = await App.findOne({ environment: environment.id, isDefault: true }) || await App.findOne({ environment: environment.id })
    if (!app || !app.containerName) throw 'notFound'

    const stream = res.sse()

    // Send initial connected message
    stream.send({ connected: true, container: app.containerName })

    // Spawn `docker logs --follow` as a child process
    const dockerPath = sails.config.docker?.binaryPath || 'docker'
    const args = ['logs', '--follow', '--tail', String(tail), '--timestamps', app.containerName]

    sails.log.debug(`[stream-container-logs] Starting docker logs for container: ${app.containerName}`)

    const docker = spawn(dockerPath, args)

    function onData(data) {
      const lines = data.toString().split('\n')
      for (const line of lines) {
        if (line.length > 0) stream.send({ log: line })
      }
    }

    docker.stdout.on('data', onData)
    docker.stderr.on('data', onData)

    docker.on('error', (err) => {
      sails.log.error(`[stream-container-logs] Docker spawn error: ${err.message}`)
      stream.send({ error: err.message })
      stream.close()
    })

    docker.on('close', (code, signal) => {
      sails.log.debug(`[stream-container-logs] Docker process closed with code: ${code}, signal: ${signal}`)
      stream.send({ closed: true })
      stream.close()
    })

    stream.onClose(() => {
      docker.kill()
    })

    return stream.wait()
  }
}
