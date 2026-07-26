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
        backupObjects: artifacts.backupObjects || [],
        volumeNames: artifacts.volumeNames || [],
        imageNames: artifacts.imageNames || [],
        sourcePaths: artifacts.sourcePaths || []
      }
      return result
    }

    for (const backup of artifacts.backupObjects || []) {
      await sails.helpers.backup.deleteBackupObject.with({
        s3Key: backup.s3Key
      })
      result.backupObjects += 1
    }

    for (const volumeName of artifacts.volumeNames || []) {
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
