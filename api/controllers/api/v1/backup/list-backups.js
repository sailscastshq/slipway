module.exports = {
  friendlyName: 'List backups',

  description: 'List backups for a service.',

  inputs: {
    before: { type: 'number', min: 1 },
    selectedBackupId: { type: 'number', min: 1 },
    serviceId: {
      type: 'string',
      required: true,
      description: 'Service ID'
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
    }
  },

  fn: async function ({ serviceId, before, selectedBackupId }) {
    const user = await User.forRequest(this.req)

    const service = await Service.findOne({ id: serviceId }).populate(
      'environment'
    )
    if (!service) {
      throw 'notFound'
    }

    const environment = await Environment.findOne({
      id: service.environment.id
    }).populate('project')
    const project = await Project.findOne({
      id: environment.project.id
    }).populate('team')

    if (project.team.id !== user.team) {
      throw 'forbidden'
    }

    const backups = await Backup.find({
      service: service.id,
      ...(before ? { id: { '<': before } } : {})
    })
      .sort('id DESC')
      .limit(21)

    const hasMore = backups.length > 20
    backups.splice(20)
    if (selectedBackupId && !backups.some((b) => b.id === selectedBackupId)) {
      const selected = await Backup.findOne({
        id: selectedBackupId,
        service: service.id
      })
      if (selected) backups.push(selected)
    }
    const userIds = [
      ...new Set(backups.map((b) => b.triggeredBy).filter(Boolean))
    ]
    const users = userIds.length
      ? await User.find({ id: userIds }).select(['fullName'])
      : []
    const authors = new Map(users.map((user) => [user.id, user.fullName]))
    const ids = backups.map((b) => b.id)
    const result = ids.length
      ? await sails
          .getDatastore()
          .sendNativeQuery(
            `SELECT MAX(id) AS id FROM restore_tests WHERE team=? AND backup IN (${ids
              .map(() => '?')
              .join(',')}) GROUP BY backup`,
            [user.team, ...ids]
          )
      : { rows: [] }
    const testIds = (result.rows || []).map((row) => row.id)
    const tests = testIds.length
      ? await RestoreTest.find({ id: testIds, team: user.team })
      : []
    const latest = new Map()
    for (const test of tests)
      if (!latest.has(test.backup)) latest.set(test.backup, test)
    return {
      hasMore,
      nextCursor: hasMore ? backups[19].id : null,
      testSupported:
        service.type === 'postgresql' && service.managementMode !== 'external',
      testLimits: {
        maxBytes: sails.config.custom.databaseOperations.restoreTestMaxBytes,
        memoryBytes:
          sails.config.custom.databaseOperations.restoreTestMemoryBytes,
        dataBytes: sails.config.custom.databaseOperations.restoreTestDataBytes
      },
      backups: backups.map((b) => ({
        id: b.id,
        status: b.status,
        type: b.type,
        s3Key: b.s3Key,
        objectKey: b.objectKey || b.s3Key,
        storage: {
          provider: b.storage?.provider,
          container: b.storage?.container,
          checksum: b.storage?.checksum,
          database: b.storage?.database
        },
        restoreTest: latest.has(b.id)
          ? ((test) => ({
              id: test.id,
              backup: test.backup,
              status: test.status,
              stage: test.stage,
              report: test.report,
              error: test.error,
              cleanupPending: test.cleanupPending,
              startedAt: test.startedAt,
              completedAt: test.completedAt
            }))(latest.get(b.id))
          : null,
        sizeBytes: b.sizeBytes,
        durationMs: b.durationMs,
        errorMessage: b.errorMessage,
        startedAt: b.startedAt,
        completedAt: b.completedAt,
        createdAt: b.createdAt,
        triggeredBy: authors.has(b.triggeredBy)
          ? { fullName: authors.get(b.triggeredBy) }
          : null
      }))
    }
  }
}
