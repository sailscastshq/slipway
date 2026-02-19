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

    const stream = res.sse()

    // Send initial connected message
    stream.send({ connected: true, container: service.containerName })

    // Spawn `docker logs --follow` as a child process
    const dockerPath = sails.config.docker?.binaryPath || 'docker'
    const args = ['logs', '--follow', '--tail', String(tail), '--timestamps', service.containerName]

    sails.log.debug(`[stream-logs] Starting docker logs for container: ${service.containerName}`)

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
      sails.log.error(`[stream-logs] Docker spawn error: ${err.message}`)
      stream.send({ error: err.message })
      stream.close()
    })

    docker.on('close', (code, signal) => {
      sails.log.debug(`[stream-logs] Docker process closed with code: ${code}, signal: ${signal}`)
      stream.send({ closed: true })
      stream.close()
    })

    stream.onClose(() => {
      docker.kill()
    })

    return stream.wait()
  }
}
