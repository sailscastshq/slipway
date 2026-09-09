/**
 * stream-logs.js
 *
 * SSE endpoint that streams live service container logs via `docker logs --follow`.
 */

const { spawn } = require('child_process')
const createLineFramer = require('../../../../lib/create-line-framer')

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

    const user = await User.forRequest(req, { populateTeam: true })
    if (!user) throw 'notFound'

    const service = await Service.findOne({ id: serviceId }).populate(
      'environment'
    )
    if (!service) throw 'notFound'

    const environment = await Environment.findOne({
      id: service.environment.id
    }).populate('project')
    if (!environment) throw 'notFound'

    const project = await Project.findOne({ id: environment.project.id })
    if (!project || project.team !== user.team.id) throw 'notFound'

    if (!service.containerName) throw 'notFound'

    const custom = require('../../../../lib/custom-service')
    const definition =
      service.type === 'custom'
        ? (await Service.findOne({ id: service.id }).decrypt()).customDefinition
        : null
    if (service.type === 'custom' && !(await custom.inspectContainer(service)))
      throw 'notFound'
    const redact = (line) =>
      definition ? custom.redactLogs(line, definition) : line
    const stream = res.sse()

    // Send initial connected message
    stream.send({ connected: true, container: service.containerName })

    // Spawn `docker logs --follow` as a child process
    const dockerPath = sails.config.docker?.binaryPath || 'docker'
    const args = [
      'logs',
      '--follow',
      '--tail',
      String(tail),
      '--timestamps',
      service.containerName
    ]

    sails.log.debug(
      `[stream-logs] Starting docker logs for container: ${service.containerName}`
    )

    const docker = spawn(dockerPath, args)

    const stdoutLines = createLineFramer({
      onLine(line) {
        stream.send({ log: redact(line) })
      }
    })
    const stderrLines = createLineFramer({
      onLine(line) {
        stream.send({ log: redact(line) })
      }
    })

    docker.stdout.on('data', (data) => stdoutLines.write(data))
    docker.stderr.on('data', (data) => stderrLines.write(data))

    docker.on('error', (err) => {
      sails.log.error(`[stream-logs] Docker spawn error: ${err.message}`)
      stream.send({ error: err.message })
      stream.close()
    })

    docker.on('close', (code, signal) => {
      stdoutLines.end()
      stderrLines.end()
      sails.log.debug(
        `[stream-logs] Docker process closed with code: ${code}, signal: ${signal}`
      )
      stream.send({ closed: true })
      stream.close()
    })

    stream.onClose(() => {
      docker.kill()
    })

    return stream.wait()
  }
}
