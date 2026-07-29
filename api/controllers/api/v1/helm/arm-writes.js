const crypto = require('node:crypto')

module.exports = {
  friendlyName: 'Arm Helm writes',

  description:
    'Issue a short-lived, single-use capability for an exact production Helm source and target.',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true
    },
    environmentSlug: {
      type: 'string',
      required: true
    },
    appSlug: {
      type: 'string'
    },
    code: {
      type: 'string',
      required: true
    }
  },

  exits: {
    success: { statusCode: 201 },
    badRequest: { responseType: 'badRequest' },
    notFound: { statusCode: 404 },
    forbidden: { statusCode: 403 }
  },

  fn: async function ({ projectSlug, environmentSlug, appSlug, code }) {
    if (Buffer.byteLength(code) > sails.config.custom.helm.maxSourceBytes) {
      throw { badRequest: 'Helm source exceeds the configured size limit.' }
    }
    const scope = await sails.helpers.helm
      .resolveProjectScope(
        this.req.session.userId,
        projectSlug,
        environmentSlug,
        appSlug
      )
      .intercept('notFound', 'notFound')
      .intercept('forbidden', 'forbidden')

    if (!scope.environment.isProduction) {
      throw {
        badRequest:
          'Write arming is only used for production Helm environments.'
      }
    }

    const classification = sails.helpers.helm.classifyMutations(code)
    if (!classification.mutating) {
      throw {
        badRequest:
          'No obvious mutation was detected in this source. You can run it normally.'
      }
    }

    const sourceHash = sails.helpers.helm.hashSource(code)
    const target = sails.helpers.helm.describeTarget(scope)
    const token = crypto.randomBytes(32).toString('base64url')
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
    const now = Date.now()
    const expiresAt = now + sails.config.custom.helm.writeArmTtlMs

    await HelmWriteArm.create({
      tokenHash,
      sourceHash,
      targetFingerprint: target.fingerprint,
      expiresAt,
      usedAt: null,
      user: scope.user.id,
      team: scope.project.team.id,
      project: scope.project.id,
      environment: scope.environment.id,
      app: scope.app.id
    })

    await HelmWriteArm.destroy({ expiresAt: { '<': now } })

    await sails.helpers.audit.log.with({
      action: 'helm.writes.armed',
      resourceType: 'app',
      resourceId: String(scope.app.id),
      details: auditDetails({
        target,
        sourceHash,
        sourceBytes: Buffer.byteLength(code),
        classification,
        expiresAt
      }),
      userId: String(scope.user.id),
      teamId: String(scope.project.team.id),
      ipAddress: this.req.ip
    })
    await safelyPruneAudit(scope.project.team.id, now)

    this.res.set('Cache-Control', 'private, no-store')
    return {
      token,
      sourceHash,
      expiresAt,
      classification,
      target: publicTarget(target)
    }
  }
}

function auditDetails({
  target,
  sourceHash,
  sourceBytes,
  classification,
  expiresAt
}) {
  return {
    ...publicTarget(target),
    targetFingerprint: target.fingerprint,
    sourceHash,
    sourceBytes,
    classifierComplete: classification.complete,
    mutationKinds: [
      ...new Set(classification.findings.map((item) => item.kind))
    ],
    mutationMethods: [
      ...new Set(classification.findings.map((item) => item.method))
    ],
    expiresAt
  }
}

function publicTarget(target) {
  const { fingerprint, ...safeTarget } = target
  return safeTarget
}

async function safelyPruneAudit(teamId, now) {
  try {
    await sails.helpers.helm.pruneAudit(teamId, now)
  } catch (error) {
    sails.log.verbose(`Could not prune Helm audit: ${error.message || error}`)
  }
}
