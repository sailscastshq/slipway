const { test } = require('sounding')

test(
  'service recreation reuses its immutable image and existing volume',
  {
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'pinned-service',
          name: 'Pinned Service'
        }
      }
    }
  },
  async ({ sails, world, expect }) => {
    const service = await world.create('service').with({
      environment: world.current.environments.production.id,
      name: 'main-db',
      version: '16',
      status: 'stopped',
      containerName: 'slipway-pinned-service-production-main-db',
      imageReference: 'postgres@sha256:existing',
      imageMetadata: {
        volumeName: 'slipway-pinned-service-data'
      }
    })
    const originalResolve = sails.helpers.docker.resolveServiceImage
    const originalRun = sails.helpers.docker.runServiceContainer
    let runInputs

    const rejectResolution = async () => {
      throw new Error('The mutable tag must not be resolved again')
    }
    rejectResolution.with = rejectResolution
    sails.helpers.docker.resolveServiceImage = rejectResolution

    const captureRun = async (inputs) => {
      runInputs = inputs
      return {
        containerId: 'immutable-container-id',
        containerName: inputs.containerName,
        volumeName: inputs.volumeName,
        imageReference: inputs.imageReference
      }
    }
    captureRun.with = captureRun
    sails.helpers.docker.runServiceContainer = captureRun

    try {
      await sails.helpers.docker.createService(service.id)

      expect(runInputs.imageReference).toBe('postgres@sha256:existing')
      expect(runInputs.volumeName).toBe('slipway-pinned-service-data')
      const updated = await sails.models.service.findOne({ id: service.id })
      expect(updated.status).toBe('running')
      expect(updated.imageReference).toBe('postgres@sha256:existing')
    } finally {
      sails.helpers.docker.resolveServiceImage = originalResolve
      sails.helpers.docker.runServiceContainer = originalRun
    }
  }
)

test(
  'legacy latest records are pinned from Docker without recreating the service',
  {
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'legacy-service',
          name: 'Legacy Service'
        }
      }
    }
  },
  async ({ sails, world, expect }) => {
    const service = await world.create('service').with({
      environment: world.current.environments.production.id,
      name: 'legacy-db',
      version: 'latest',
      status: 'running',
      containerName: 'slipway-legacy-service-production-legacy-db'
    })
    const originalInspect = sails.helpers.docker.inspectRunningServiceImage

    const inspectExisting = async () => ({
      version: '17',
      detectedVersion: '17.6',
      imageReference: 'postgres@sha256:running',
      imageId: 'sha256:running',
      repoDigest: 'postgres@sha256:running',
      configuredImage: 'postgres:latest'
    })
    inspectExisting.with = inspectExisting
    sails.helpers.docker.inspectRunningServiceImage = inspectExisting

    try {
      const result = await sails.helpers.service.migrateLegacyVersions()
      const updated = await sails.models.service.findOne({ id: service.id })

      expect(result.migrated).toBe(1)
      expect(updated.version).toBe('17')
      expect(updated.imageReference).toBe('postgres@sha256:running')
      expect(updated.containerName).toBe(service.containerName)
      expect(updated.status).toBe('running')
    } finally {
      sails.helpers.docker.inspectRunningServiceImage = originalInspect
    }
  }
)

test(
  'a deliberate major upgrade backs up, restores, and retains recovery state',
  {
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'upgrade-service',
          name: 'Upgrade Service'
        }
      }
    }
  },
  async ({ sails, world, expect }) => {
    const service = await world.create('service').with({
      environment: world.current.environments.production.id,
      name: 'main-db',
      version: '16',
      status: 'running',
      containerName: 'slipway-upgrade-service-production-main-db',
      imageReference: 'postgres@sha256:version-16',
      imageMetadata: {
        volumeName: 'slipway-upgrade-service-main-db-data'
      },
      database: 'upgrade_service',
      username: 'slipway_main_db',
      password: 'secret'
    })
    const calls = []
    const originals = {
      runBackup: sails.helpers.backup.runBackup,
      restoreBackup: sails.helpers.backup.restoreBackup,
      resolve: sails.helpers.docker.resolveServiceImage,
      run: sails.helpers.docker.runServiceContainer,
      wait: sails.helpers.docker.waitForService,
      swap: sails.helpers.docker.swapServiceContainers,
      discard: sails.helpers.docker.discardServiceCandidate,
      audit: sails.helpers.audit.log
    }

    replace(sails.helpers.backup, 'runBackup', async ({ backupId }) => {
      calls.push('backup')
      return sails.models.backup.updateOne({ id: backupId }).set({
        status: 'completed',
        s3Key: `backups/${backupId}.dmp`,
        sizeBytes: 2048,
        completedAt: Date.now()
      })
    })
    replace(sails.helpers.docker, 'resolveServiceImage', async () => {
      calls.push('image')
      return {
        imageReference: 'postgres@sha256:version-17',
        imageTag: 'postgres:17',
        imageId: 'sha256:version-17',
        repoDigest: 'postgres@sha256:version-17',
        resolvedAt: Date.now(),
        usedLocalFallback: false
      }
    })
    replace(sails.helpers.docker, 'runServiceContainer', async (inputs) => {
      calls.push('candidate')
      return {
        containerId: 'candidate-container-id',
        containerName: inputs.containerName,
        volumeName: inputs.volumeName,
        imageReference: inputs.imageReference
      }
    })
    replace(sails.helpers.docker, 'waitForService', async () => {
      calls.push('ready')
      return { ready: true }
    })
    replace(sails.helpers.backup, 'restoreBackup', async () => {
      calls.push('restore')
      return { success: true }
    })
    replace(sails.helpers.docker, 'swapServiceContainers', async () => {
      calls.push('cutover')
      return { committed: true }
    })
    replace(sails.helpers.docker, 'discardServiceCandidate', async () => {})
    replace(sails.helpers.audit, 'log', async () => {
      calls.push('audit')
    })

    try {
      const state = await sails.helpers.service.runVersionUpgrade.with({
        serviceId: service.id,
        targetVersion: '17',
        userId: String(world.current.users.genesisUser.id),
        teamId: String(world.current.teams.genesisTeam.id),
        ipAddress: '127.0.0.1'
      })
      const updated = await sails.models.service.findOne({ id: service.id })

      expect(state.status).toBe('completed')
      expect(calls).toEqual([
        'backup',
        'image',
        'candidate',
        'ready',
        'restore',
        'ready',
        'cutover',
        'audit'
      ])
      expect(updated.version).toBe('17')
      expect(updated.imageReference).toBe('postgres@sha256:version-17')
      expect(updated.imageMetadata.previous.version).toBe('16')
      expect(updated.upgradeState.recovery.backupId).toBeDefined()
      expect(updated.status).toBe('running')
    } finally {
      sails.helpers.backup.runBackup = originals.runBackup
      sails.helpers.backup.restoreBackup = originals.restoreBackup
      sails.helpers.docker.resolveServiceImage = originals.resolve
      sails.helpers.docker.runServiceContainer = originals.run
      sails.helpers.docker.waitForService = originals.wait
      sails.helpers.docker.swapServiceContainers = originals.swap
      sails.helpers.docker.discardServiceCandidate = originals.discard
      sails.helpers.audit.log = originals.audit
    }
  }
)

test(
  'a failed restore discards the candidate and leaves the original service pinned',
  {
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'failed-upgrade',
          name: 'Failed Upgrade'
        }
      }
    }
  },
  async ({ sails, world, expect }) => {
    const service = await world.create('service').with({
      environment: world.current.environments.production.id,
      name: 'main-db',
      version: '16',
      status: 'running',
      containerName: 'slipway-failed-upgrade-production-main-db',
      imageReference: 'postgres@sha256:version-16',
      imageMetadata: {
        volumeName: 'slipway-failed-upgrade-main-db-data'
      }
    })
    const calls = []
    const originals = {
      runBackup: sails.helpers.backup.runBackup,
      restoreBackup: sails.helpers.backup.restoreBackup,
      resolve: sails.helpers.docker.resolveServiceImage,
      run: sails.helpers.docker.runServiceContainer,
      wait: sails.helpers.docker.waitForService,
      swap: sails.helpers.docker.swapServiceContainers,
      discard: sails.helpers.docker.discardServiceCandidate
    }

    replace(sails.helpers.backup, 'runBackup', async ({ backupId }) => {
      return sails.models.backup.updateOne({ id: backupId }).set({
        status: 'completed',
        s3Key: `backups/${backupId}.dmp`,
        sizeBytes: 2048,
        completedAt: Date.now()
      })
    })
    replace(sails.helpers.docker, 'resolveServiceImage', async () => ({
      imageReference: 'postgres@sha256:version-17',
      imageTag: 'postgres:17',
      imageId: 'sha256:version-17',
      repoDigest: 'postgres@sha256:version-17',
      resolvedAt: Date.now(),
      usedLocalFallback: false
    }))
    replace(sails.helpers.docker, 'runServiceContainer', async (inputs) => ({
      containerId: 'candidate-container-id',
      containerName: inputs.containerName,
      volumeName: inputs.volumeName,
      imageReference: inputs.imageReference
    }))
    replace(sails.helpers.docker, 'waitForService', async () => ({
      ready: true
    }))
    replace(sails.helpers.backup, 'restoreBackup', async () => {
      throw new Error('The backup is incompatible with the target version.')
    })
    replace(sails.helpers.docker, 'swapServiceContainers', async () => {
      calls.push('cutover')
    })
    replace(sails.helpers.docker, 'discardServiceCandidate', async (inputs) => {
      calls.push({ discarded: inputs })
    })

    try {
      const state = await sails.helpers.service.runVersionUpgrade.with({
        serviceId: service.id,
        targetVersion: '17',
        userId: String(world.current.users.genesisUser.id),
        teamId: String(world.current.teams.genesisTeam.id),
        ipAddress: '127.0.0.1'
      })
      const updated = await sails.models.service.findOne({ id: service.id })

      expect(state.status).toBe('failed')
      expect(state.message).toContain('incompatible with the target version')
      expect(calls.some((call) => call === 'cutover')).toBe(false)
      expect(
        calls.some(
          (call) =>
            call.discarded?.containerName.includes('-upgrade-') &&
            call.discarded?.volumeName.endsWith('-data')
        )
      ).toBe(true)
      expect(updated.version).toBe('16')
      expect(updated.imageReference).toBe('postgres@sha256:version-16')
      expect(updated.status).toBe('running')
    } finally {
      sails.helpers.backup.runBackup = originals.runBackup
      sails.helpers.backup.restoreBackup = originals.restoreBackup
      sails.helpers.docker.resolveServiceImage = originals.resolve
      sails.helpers.docker.runServiceContainer = originals.run
      sails.helpers.docker.waitForService = originals.wait
      sails.helpers.docker.swapServiceContainers = originals.swap
      sails.helpers.docker.discardServiceCandidate = originals.discard
    }
  }
)

function replace(namespace, name, implementation) {
  implementation.with = implementation
  namespace[name] = implementation
}
