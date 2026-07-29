module.exports = {
  friendlyName: 'Record Helm execution',

  description:
    'Persist bounded execution metadata and an independent source-free audit event.',

  inputs: {
    scope: {
      type: 'ref',
      required: true
    },
    source: {
      type: 'string',
      required: true
    },
    result: {
      type: 'ref',
      required: true
    },
    startedAt: {
      type: 'number',
      required: true
    },
    sourceHash: {
      type: 'string',
      required: true
    },
    target: {
      type: 'ref',
      required: true
    },
    classification: {
      type: 'ref',
      required: true
    },
    writeArmed: {
      type: 'boolean',
      defaultsTo: false
    },
    ipAddress: {
      type: 'string'
    }
  },

  fn: async function ({
    scope,
    source,
    result,
    startedAt,
    sourceHash,
    target,
    classification,
    writeArmed,
    ipAddress
  }) {
    const executedAt = startedAt
    const status = normalizeStatus(result)
    const durationMs = Math.max(0, Math.round(Number(result.durationMs) || 0))
    const outputBytes = Math.max(
      0,
      Math.round(
        Number(result.outputBytes) ||
          Buffer.byteLength(String(result.output || ''))
      )
    )
    let historyEntry = null

    try {
      historyEntry = await HelmHistoryEntry.create({
        source,
        status,
        durationMs,
        executedAt,
        target: scope.app.slug,
        targetContext: publicTarget(target),
        user: scope.user.id,
        team: scope.project.team.id,
        project: scope.project.id,
        environment: scope.environment.id,
        app: scope.app.id
      }).fetch()

      await pruneHistory(scope, executedAt)
    } catch (error) {
      sails.log.verbose(
        `Could not persist Helm history: ${error.message || error}`
      )
    }

    await sails.helpers.audit.log.with({
      action: 'helm.executed',
      resourceType: 'app',
      resourceId: String(scope.app.id),
      details: {
        projectId: scope.project.id,
        environmentId: scope.environment.id,
        ...publicTarget(target),
        targetFingerprint: target.fingerprint,
        sourceHash,
        startedAt,
        status,
        durationMs,
        outputBytes,
        sourceBytes: Buffer.byteLength(source),
        classifierComplete: classification.complete,
        mutationDetected: classification.mutating,
        mutationKinds: [
          ...new Set(classification.findings.map((item) => item.kind))
        ],
        mutationMethods: [
          ...new Set(classification.findings.map((item) => item.method))
        ],
        writeArmed
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

    return historyEntry
  }
}

function publicTarget(target) {
  const { fingerprint, ...safeTarget } = target
  return safeTarget
}

function normalizeStatus(result) {
  if (['success', 'error', 'timeout', 'cancelled'].includes(result?.status)) {
    return result.status
  }
  return result?.success ? 'success' : 'error'
}

async function pruneHistory(scope, now) {
  const retentionMs = sails.config.custom.helm.historyRetentionMs
  const maxEntries = sails.config.custom.helm.historyMaxEntriesPerScope
  const criteria = {
    user: scope.user.id,
    project: scope.project.id,
    environment: scope.environment.id,
    pinned: false
  }

  await HelmHistoryEntry.destroy({
    ...criteria,
    executedAt: { '<': now - retentionMs }
  })

  const overflow = await HelmHistoryEntry.find(criteria)
    .sort(['executedAt DESC', 'id DESC'])
    .skip(maxEntries)
    .limit(1000)
  if (overflow.length > 0) {
    await HelmHistoryEntry.destroy({
      id: overflow.map((entry) => entry.id)
    })
  }
}
