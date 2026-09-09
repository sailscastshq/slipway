module.exports = {
  friendlyName: 'Remove cleanup artifacts',

  description:
    'Remove temporary artifacts and optionally purge retained recovery data.',

  inputs: {
    snapshot: {
      type: 'ref',
      required: true
    },
    retentionPolicy: {
      type: 'string',
      required: true,
      isIn: ['retain', 'purge']
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ snapshot, retentionPolicy }) {
    const artifacts = snapshot.artifacts || {}
    const result = {
      buildContexts: 0,
      backupObjects: 0,
      volumes: 0,
      images: 0,
      sourcePaths: 0,
      retained: {}
    }

    for (const context of artifacts.buildContexts || []) {
      const cleanup = await sails.helpers.deploy.cleanupBuildContext.with({
        contextPath: context.contextPath,
        deploymentId: String(context.deploymentId)
      })
      if (cleanup.removed) result.buildContexts += 1
    }

    if (retentionPolicy === 'retain') {
      result.retained = {
        backupObjects: (artifacts.backupObjects || []).map(
          ({ backupId, objectKey, s3Key }) => ({
            backupId,
            objectKey: objectKey || s3Key
          })
        ),
        volumeNames: artifacts.volumeNames || [],
        imageNames: artifacts.imageNames || [],
        sourcePaths: artifacts.sourcePaths || []
      }
      return result
    }

    for (const backup of artifacts.backupObjects || []) {
      await sails.helpers.backup.deleteBackupObject.with({
        objectKey: backup.objectKey || backup.s3Key,
        storageConfig: backup.storage
          ? require('../../lib/sealed-backup-storage').open(backup.storage)
          : undefined
      })
      result.backupObjects += 1
    }

    for (const volumeName of artifacts.volumeNames || []) {
      const service = snapshot.services?.find(
        (s) =>
          s.type === 'custom' &&
          s.customState?.volumes?.some((v) => v.name === volumeName)
      )
      if (service) {
        const custom = require('../../lib/custom-service')
        try {
          const volume = JSON.parse(
            (await custom.command(['volume', 'inspect', volumeName])).stdout
          )[0]
          if (volume.Labels?.['slipway.custom-service'] !== String(service.id))
            custom.fail(
              'The data volume belongs to another resource. It was left unchanged.'
            )
        } catch (error) {
          if (!/No such volume/i.test(error.stderr || '')) throw error
        }
      }
      const removed = await sails.helpers.docker.removeVolume.with({
        volumeName
      })
      if (removed.removed) result.volumes += 1
    }

    for (const imageName of artifacts.imageNames || []) {
      const removed = await sails.helpers.docker.removeImage.with({ imageName })
      if (removed?.removed !== false) result.images += 1
    }

    for (const sourcePath of artifacts.sourcePaths || []) {
      await sails.helpers.cleanup.removeSource.with({ sourcePath })
      result.sourcePaths += 1
    }

    return result
  }
}
