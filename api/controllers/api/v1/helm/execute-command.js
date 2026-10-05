const { StringDecoder } = require('node:string_decoder')
const helmCommand = require('../../../../lib/helm-command')
const expectedHelmRuntime = require('../../../../lib/helm-expected-runtime')

module.exports = {
  friendlyName: 'Execute Helm command',
  description:
    'Stream one bounded, non-interactive command in the selected deployed app.',

  inputs: {
    projectSlug: { type: 'string', required: true },
    environmentSlug: { type: 'string', required: true },
    appSlug: { type: 'string' },
    code: { type: 'string', required: true },
    executionId: {
      type: 'string',
      required: true,
      regex:
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    },
    writeArmToken: { type: 'string', maxLength: 200 }
  },

  exits: {
    success: { statusCode: 200 },
    badRequest: { responseType: 'badRequest' },
    notFound: { statusCode: 404 },
    forbidden: { statusCode: 403 },
    conflict: { statusCode: 409 }
  },

  fn: async function ({
    projectSlug,
    environmentSlug,
    appSlug,
    code,
    executionId,
    writeArmToken
  }) {
    const scope = await sails.helpers.helm
      .resolveProjectScope(
        this.req.auth?.userId || this.req.session.userId,
        projectSlug,
        environmentSlug,
        appSlug,
        this.req
      )
      .intercept('notFound', 'notFound')
      .intercept('forbidden', 'forbidden')
    // Match the existing administrative command capability used by Dock.
    if (!['owner', 'admin'].includes(scope.user.teamRole)) throw 'forbidden'
    if (scope.app.status !== 'running' || !scope.app.containerName) {
      throw { badRequest: 'App is not running.' }
    }

    let argv
    try {
      argv = helmCommand.parseCommand(code, {
        maxBytes: sails.config.custom.helm.maxSourceBytes
      })
    } catch (error) {
      if (error.code === 'HELM_COMMAND_INVALID')
        return this.res
          .status(400)
          .json({ code: error.code, message: error.message })
      throw error
    }
    const classification = helmCommand.classifyCommand(code)
    const sourceHash = helmCommand.hashCommand(code)
    const target = sails.helpers.helm.describeTarget(scope)
    const { fingerprint, ...publicTarget } = target
    let writeArmed = false
    if (scope.environment.isProduction) {
      if (writeArmToken) {
        writeArmed = Boolean(
          await sails.helpers.helm.consumeWriteArm.with({
            token: writeArmToken,
            scope,
            sourceHash,
            targetFingerprint: target.fingerprint
          })
        )
      }
      if (!writeArmed) {
        await sails.helpers.audit.log.with({
          action: 'helm.execution.blocked',
          resourceType: 'app',
          resourceId: String(scope.app.id),
          details: {
            ...publicTarget,
            mode: 'command',
            sourceHash,
            sourceBytes: Buffer.byteLength(code),
            targetFingerprint: target.fingerprint,
            status: 'blocked',
            reason: writeArmToken ? 'invalid-or-expired-arm' : 'not-armed'
          },
          userId: String(scope.user.id),
          teamId: String(scope.project.team.id),
          ipAddress: this.req.ip
        })
        throw {
          conflict: {
            code: 'HELM_WRITES_NOT_ARMED',
            message:
              'Every production command requires a single-use write arm for this exact command and deployment.',
            sourceHash,
            classification,
            target: publicTarget
          }
        }
      }
    }

    const expectedRuntime = await expectedHelmRuntime(scope.app)
    // New command mode never guesses a legacy app process or environment.
    expectedRuntime.required = true
    const execution = sails.helpers.helm.beginExecution.with({
      executionId,
      req: this.req,
      res: this.res,
      requiresConfirmedCancellation: true
    })
    if (execution.signal.aborted) {
      execution.release({ status: 'cancelled', terminationConfirmed: true })
      return undefined
    }
    const startedAt = Date.now()
    let result
    let emittedBytes = 0
    let started = false
    const response = this.res
    const send = (event) => {
      if (response.destroyed || response.writableEnded) return
      response.write(`${JSON.stringify(event)}\n`)
    }
    response.set('Content-Type', 'application/x-ndjson; charset=utf-8')
    response.set('Cache-Control', 'private, no-store')
    response.set('X-Accel-Buffering', 'no')
    response.status(200)
    response.flushHeaders?.()
    send({ type: 'accepted', executionId, target: publicTarget })

    try {
      result = await sails.helpers.helm.executeCommandInContainer.with({
        containerName: scope.app.containerName,
        argv,
        executionId,
        signal: execution.signal,
        expectedRuntime,
        onEvent(event) {
          if (event?.type === 'started') {
            if (started) return
            started = true
            send({ type: 'started' })
            return
          }
          if (
            !['stdout', 'stderr'].includes(event?.type) ||
            typeof event.text !== 'string'
          )
            return
          // The runner enforces the primary bound; keep the transport bounded
          // independently rather than trusting arbitrary event-sized payloads.
          const remaining = Math.max(
            0,
            sails.config.custom.helm.maxLogBytes - emittedBytes
          )
          if (!remaining) return
          const bytes = Buffer.from(event.text)
          const bounded = new StringDecoder('utf8').write(
            bytes.subarray(0, remaining)
          )
          if (!bounded) return
          emittedBytes += Buffer.byteLength(bounded)
          send({ type: event.type, text: bounded })
        }
      })
    } catch {
      // Losing the client/transport is not evidence the in-container work ended.
      result = {
        success: false,
        status: 'unconfirmed',
        exitCode: null,
        signal: null,
        durationMs: Date.now() - startedAt,
        outputBytes: emittedBytes,
        truncated: false,
        error: {
          code: 'HELM_COMMAND_UNCONFIRMED',
          message:
            'Command outcome is unconfirmed. Check the app before running it again.'
        }
      }
    }

    try {
      await sails.helpers.helm.recordExecution.with({
        scope,
        mode: 'command',
        source: code,
        result,
        startedAt,
        sourceHash,
        target,
        classification,
        writeArmed,
        ipAddress: this.req.ip
      })
    } catch (error) {
      sails.log.warn(`Could not record Helm command metadata: ${error.message}`)
    } finally {
      try {
        const { stdout, stderr, output, ...terminalMetadata } = result
        send({ type: 'result', executionId, result: terminalMetadata })
        if (!response.destroyed && !response.writableEnded) response.end()
      } finally {
        execution.release(result)
      }
    }
    return undefined
  }
}
