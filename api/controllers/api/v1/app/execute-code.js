module.exports = {
  friendlyName: 'Execute code',

  description:
    'Execute JavaScript code inside a running app container (Helm REPL).',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true
    },
    environmentSlug: {
      type: 'string',
      required: true
    },
    code: {
      type: 'string',
      required: true,
      description: 'JavaScript code to execute'
    },
    executionId: {
      type: 'string',
      required: true,
      regex:
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    },
    sourceStartLine: {
      type: 'number',
      defaultsTo: 1,
      min: 1,
      max: 1000000
    },
    sourceStartColumn: {
      type: 'number',
      defaultsTo: 1,
      min: 1,
      max: 1000000
    },
    appSlug: {
      type: 'string',
      description: 'Target app slug (defaults to default app)'
    },
    writeArmToken: {
      type: 'string',
      maxLength: 200,
      description:
        'Short-lived, single-use capability for an exact production mutation'
    }
  },

  exits: {
    success: {
      statusCode: 200
    },
    notFound: {
      statusCode: 404
    },
    forbidden: {
      statusCode: 403
    },
    badRequest: {
      responseType: 'badRequest'
    },
    conflict: {
      statusCode: 409
    }
  },

  fn: async function ({
    projectSlug,
    environmentSlug,
    code,
    executionId,
    sourceStartLine,
    sourceStartColumn,
    appSlug,
    writeArmToken
  }) {
    const scope = await sails.helpers.helm
      .resolveProjectScope(
        this.req.session.userId,
        projectSlug,
        environmentSlug,
        appSlug
      )
      .intercept('notFound', 'notFound')
      .intercept('forbidden', 'forbidden')
    const app = scope.app

    if (!app || app.status !== 'running' || !app.containerName) {
      throw { badRequest: 'App is not running.' }
    }

    const classification = sails.helpers.helm.classifyMutations(code)
    const sourceHash = sails.helpers.helm.hashSource(code)
    const target = sails.helpers.helm.describeTarget(scope)
    let writeArmed = false

    if (scope.environment.isProduction && classification.mutating) {
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
        await recordBlockedExecution({
          scope,
          source: code,
          sourceHash,
          target,
          classification,
          ipAddress: this.req.ip,
          reason: writeArmToken ? 'invalid-or-expired-arm' : 'not-armed'
        })
        throw {
          conflict: {
            code: 'HELM_WRITES_NOT_ARMED',
            message: writeArmToken
              ? 'The production write arm expired or no longer matches this source and target.'
              : 'Production writes must be armed before they can run.',
            sourceHash,
            classification,
            target: publicTarget(target)
          }
        }
      }
    }

    const execution = sails.helpers.helm.beginExecution(
      executionId,
      this.req,
      this.res
    )
    const startedAt = Date.now()

    try {
      const result = await sails.helpers.helm.executeInContainer(
        app.containerName,
        code,
        sourceStartLine,
        sourceStartColumn,
        executionId,
        execution.signal
      )
      await sails.helpers.helm.recordExecution.with({
        scope,
        source: code,
        result,
        startedAt,
        sourceHash,
        target,
        classification,
        writeArmed,
        ipAddress: this.req.ip
      })
      return result
    } catch (error) {
      await sails.helpers.helm.recordExecution.with({
        scope,
        source: code,
        result: {
          status: 'error',
          success: false,
          durationMs: Date.now() - startedAt
        },
        startedAt,
        sourceHash,
        target,
        classification,
        writeArmed,
        ipAddress: this.req.ip
      })
      throw error
    } finally {
      execution.release()
    }
  }
}

async function recordBlockedExecution({
  scope,
  source,
  sourceHash,
  target,
  classification,
  ipAddress,
  reason
}) {
  await sails.helpers.audit.log.with({
    action: 'helm.execution.blocked',
    resourceType: 'app',
    resourceId: String(scope.app.id),
    details: {
      ...publicTarget(target),
      targetFingerprint: target.fingerprint,
      sourceHash,
      sourceBytes: Buffer.byteLength(source),
      startedAt: Date.now(),
      status: 'blocked',
      outputBytes: 0,
      classifierComplete: classification.complete,
      mutationKinds: [
        ...new Set(classification.findings.map((item) => item.kind))
      ],
      mutationMethods: [
        ...new Set(classification.findings.map((item) => item.method))
      ],
      reason
    },
    userId: String(scope.user.id),
    teamId: String(scope.project.team.id),
    ipAddress
  })
  try {
    await sails.helpers.helm.pruneAudit(scope.project.team.id)
  } catch (error) {
    sails.log.verbose(`Could not prune Helm audit: ${error.message || error}`)
  }
}

function publicTarget(target) {
  const { fingerprint, ...safeTarget } = target
  return safeTarget
}
