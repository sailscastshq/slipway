const { getUpgradePlan } = require('../../lib/service-image-policy')

const STEPS = [
  'backup',
  'image',
  'candidate',
  'restore',
  'cutover',
  'completed'
]

module.exports = {
  friendlyName: 'Run service version upgrade',

  description:
    'Upgrade a database on a fresh volume after a verified backup, retaining the previous container for recovery.',

  inputs: {
    serviceId: {
      type: 'string',
      required: true
    },
    targetVersion: {
      type: 'string',
      required: true
    },
    userId: {
      type: 'string',
      required: true
    },
    teamId: {
      type: 'string',
      required: true
    },
    ipAddress: {
      type: 'string',
      allowNull: true
    }
  },

  fn: async function ({ serviceId, targetVersion, userId, teamId, ipAddress }) {
    const service = await Service.findOne({ id: serviceId }).decrypt()
    if (!service) throw new Error('Service not found')

    const plan = getUpgradePlan(service.type, service.version, targetVersion)
    const suffix = Date.now()
    const candidateName = `${service.containerName}-upgrade-${suffix}`
    const rollbackName = `${
      service.containerName
    }-previous-${service.version.replace(/\./g, '-')}-${suffix}`
    const candidateVolumeName = Service.getDataVolumeName(candidateName)
    const previousVolumeName =
      service.imageMetadata?.volumeName ||
      Service.getDataVolumeName(service.containerName)
    let backup
    let cutoverCommitted = false
    let candidateContainerId = null
    let activeStep = 'backup'

    await publish('backup', 'Creating and verifying a recovery backup.')

    try {
      backup = await Backup.create({
        status: 'pending',
        type: 'manual',
        service: service.id,
        triggeredBy: userId
      }).fetch()
      const completedBackup = await sails.helpers.backup.runBackup.with({
        backupId: backup.id
      })
      if (
        completedBackup.status !== 'completed' ||
        !completedBackup.s3Key ||
        !completedBackup.sizeBytes
      ) {
        throw new Error(
          `Upgrade stopped because the recovery backup failed: ${
            completedBackup.errorMessage || 'backup was not verified'
          }`
        )
      }

      await publish('image', `Resolving ${plan.label} ${plan.toVersion}.`, {
        backupId: backup.id
      })
      const resolved = await sails.helpers.docker.resolveServiceImage.with({
        type: service.type,
        version: plan.toVersion
      })

      await publish(
        'candidate',
        'Starting the new version on a fresh data volume.',
        {
          backupId: backup.id,
          imageReference: resolved.imageReference
        }
      )
      const candidate = await sails.helpers.docker.runServiceContainer.with({
        service: { ...service, version: plan.toVersion },
        containerName: candidateName,
        imageReference: resolved.imageReference,
        volumeName: candidateVolumeName
      })
      candidateContainerId = candidate.containerId
      await sails.helpers.docker.waitForService.with({
        service,
        containerName: candidateName
      })

      await publish('restore', 'Restoring the verified backup.', {
        backupId: backup.id,
        imageReference: resolved.imageReference
      })
      await sails.helpers.backup.restoreBackup.with({
        backupId: backup.id,
        targetContainerName: candidateName,
        skipSafetySnapshot: true
      })
      await sails.helpers.docker.waitForService.with({
        service: { ...service, version: plan.toVersion },
        containerName: candidateName
      })

      await publish(
        'cutover',
        'Promoting the restored container and retaining the previous version.',
        {
          backupId: backup.id,
          imageReference: resolved.imageReference
        }
      )
      await sails.helpers.docker.swapServiceContainers.with({
        action: 'commit',
        canonicalName: service.containerName,
        candidateName,
        rollbackName
      })
      cutoverCommitted = true

      const completedAt = Date.now()
      const recovery = {
        previousVersion: service.version,
        previousContainerName: rollbackName,
        previousVolumeName,
        backupId: backup.id,
        instructions: `If verification fails, stop ${service.containerName}, restore ${rollbackName} to the canonical name, and start it. The verified backup remains available as backup #${backup.id}.`
      }
      const state = await publish(
        'completed',
        `${plan.label} ${plan.toVersion} is running. The previous container is retained for recovery.`,
        {
          status: 'completed',
          backupId: backup.id,
          completedAt,
          imageReference: resolved.imageReference,
          recovery
        }
      )

      await Service.updateOne({ id: service.id }).set({
        version: plan.toVersion,
        imageReference: resolved.imageReference,
        imageMetadata: {
          source: 'upgrade',
          tag: resolved.imageTag,
          imageId: resolved.imageId,
          repoDigest: resolved.repoDigest,
          resolvedAt: resolved.resolvedAt,
          usedLocalFallback: resolved.usedLocalFallback,
          volumeName: candidateVolumeName,
          previous: {
            version: service.version,
            imageReference: service.imageReference,
            imageMetadata: service.imageMetadata,
            containerName: rollbackName,
            volumeName: previousVolumeName
          }
        },
        upgradeState: state,
        containerId: candidateContainerId,
        status: 'running'
      })

      try {
        await sails.helpers.audit.log.with({
          action: 'service.version-upgraded',
          resourceType: 'service',
          resourceId: service.id,
          details: {
            name: service.name,
            type: service.type,
            fromVersion: service.version,
            toVersion: plan.toVersion,
            backupId: backup.id,
            rollbackContainer: rollbackName
          },
          userId,
          teamId,
          ipAddress
        })
      } catch (auditError) {
        sails.log.warn(
          `Could not record service upgrade audit event: ${auditError.message}`
        )
      }

      return state
    } catch (error) {
      if (cutoverCommitted) {
        try {
          await sails.helpers.docker.swapServiceContainers.with({
            action: 'rollback',
            canonicalName: service.containerName,
            candidateName,
            rollbackName
          })
          await sails.helpers.docker.discardServiceCandidate.with({
            containerName: candidateName,
            volumeName: candidateVolumeName
          })
        } catch (rollbackError) {
          error.message += ` Automatic rollback also failed: ${rollbackError.message}`
        }
      } else {
        await sails.helpers.docker.discardServiceCandidate.with({
          containerName: candidateName,
          volumeName: candidateVolumeName
        })
      }

      const failedState = await publish(currentStep(), error.message, {
        status: 'failed',
        failedAt: Date.now(),
        backupId: backup?.id || null,
        recovery: backup
          ? {
              backupId: backup.id,
              instructions:
                'The original service was kept in place. Review the error, verify the backup, and retry the upgrade.'
            }
          : null
      })
      await Service.updateOne({ id: service.id }).set({
        status: 'running',
        upgradeState: failedState
      })
      sails.log.error(
        `Service upgrade failed for ${service.name}: ${error.message}`
      )
      return failedState
    }

    async function publish(step, message, extra = {}) {
      activeStep = step
      const previous =
        (await Service.findOne({ id: service.id }))?.upgradeState || {}
      const state = {
        ...previous,
        status: extra.status || 'running',
        fromVersion: service.version,
        targetVersion: plan.toVersion,
        candidateContainerName: candidateName,
        rollbackContainerName: rollbackName,
        candidateVolumeName,
        previousVolumeName,
        step,
        message,
        steps: STEPS.map((name) => ({
          name,
          status:
            name === step
              ? extra.status === 'failed'
                ? 'failed'
                : extra.status === 'completed'
                ? 'completed'
                : 'running'
              : STEPS.indexOf(name) < STEPS.indexOf(step)
              ? 'completed'
              : 'pending'
        })),
        startedAt: previous.startedAt || Date.now(),
        ...extra
      }
      await Service.updateOne({ id: service.id }).set({
        status: state.status === 'running' ? 'upgrading' : service.status,
        upgradeState: state
      })
      sails.sse.publish(`service-upgrade:${service.id}`, state)
      return state
    }

    function currentStep() {
      return activeStep
    }
  }
}
