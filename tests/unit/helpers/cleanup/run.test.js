const { test } = require('sounding')

function cleanupWorld(slug) {
  return {
    name: 'configured-slipway',
    context: {
      deploymentTarget: {
        slug,
        name: 'Cleanup target'
      }
    }
  }
}

test(
  'cleanup is idempotent when Docker resources are already missing',
  { world: cleanupWorld('cleanup-idempotent') },
  async ({ sails, world, expect }) => {
    const current = world.current
    const project = current.projects.deploymentTarget
    const environment = current.environments.production
    const app = await sails.models.app
      .updateOne({ id: current.apps.web.id })
      .set({
        containerName: 'missing-cleanup-app',
        imageName: 'slipway/cleanup-idempotent:current',
        hostPort: 1401
      })
    const service = await world.create('service').with({
      environment: environment.id,
      name: 'missing-db',
      status: 'running',
      containerName: 'missing-cleanup-db'
    })
    const deployment = await world.create('deployment').with({
      environment: environment.id,
      app: app.id,
      imageName: 'slipway/cleanup-idempotent:release'
    })
    await world.create('deploymentjob').with({
      deployment: deployment.id,
      targetKey: `environment:${environment.id}`,
      candidateContainerName: 'missing-candidate'
    })

    await withCleanupStubs(
      sails,
      {
        stopContainer: async () => {
          throw 'notFound'
        }
      },
      async () => {
        const inputs = {
          targetKey: `project:${project.slug}`,
          scopeType: 'project',
          resourceId: project.id,
          retentionPolicy: 'retain',
          userId: current.users.genesisUser.id,
          teamId: current.teams.genesisTeam.id
        }
        const first = await sails.helpers.cleanup.run.with(inputs)
        const second = await sails.helpers.cleanup.run.with(inputs)

        expect(first.status).toBe('complete')
        expect(second.id).toBe(first.id)
        expect(second.status).toBe('complete')
        expect(first.stages.containers.outcome.missing).toBe(3)
        expect(await sails.models.project.findOne({ id: project.id })).toBe(
          undefined
        )
        expect(
          await sails.models.cleanupoperation.count({
            targetKey: inputs.targetKey
          })
        ).toBe(1)
        expect(await sails.models.service.findOne({ id: service.id })).toBe(
          undefined
        )
      }
    )
  }
)

test(
  'concurrent cleanup requests share one operation and one runner',
  { world: cleanupWorld('cleanup-concurrent') },
  async ({ sails, world, expect }) => {
    const current = world.current
    const project = current.projects.deploymentTarget
    let releaseTraffic
    let markTrafficStarted
    const trafficReleased = new Promise((resolve) => {
      releaseTraffic = resolve
    })
    const trafficStarted = new Promise((resolve) => {
      markTrafficStarted = resolve
    })

    await withCleanupStubs(
      sails,
      {
        removeRoute: async () => {
          markTrafficStarted()
          await trafficReleased
          return { removed: true }
        }
      },
      async () => {
        const inputs = {
          targetKey: `project:${project.slug}`,
          scopeType: 'project',
          resourceId: project.id,
          retentionPolicy: 'retain',
          userId: current.users.genesisUser.id,
          teamId: current.teams.genesisTeam.id
        }
        const firstRequest = sails.helpers.cleanup.run
          .with(inputs)
          .then((result) => result)
        await trafficStarted

        const concurrentError = await captureError(
          sails.helpers.cleanup.run.with(inputs)
        )
        releaseTraffic()
        const firstResult = await firstRequest

        expect(concurrentError.code).toBe('CLEANUP_IN_PROGRESS')
        expect(concurrentError.cleanup.id).toBe(firstResult.id)
        expect(firstResult.status).toBe('complete')
        expect(
          await sails.models.cleanupoperation.count({
            targetKey: inputs.targetKey
          })
        ).toBe(1)
      }
    )
  }
)

test(
  'a recreated slug receives a new cleanup operation',
  { world: cleanupWorld('cleanup-recreated-slug') },
  async ({ sails, world, expect }) => {
    const current = world.current
    const originalProject = current.projects.deploymentTarget
    const requestKey = `project:${originalProject.slug}`

    await withCleanupStubs(sails, {}, async () => {
      const first = await sails.helpers.cleanup.run.with({
        targetKey: `project:${originalProject.id}`,
        requestKey,
        scopeType: 'project',
        resourceId: originalProject.id,
        retentionPolicy: 'retain',
        userId: current.users.genesisUser.id,
        teamId: current.teams.genesisTeam.id
      })

      const recreatedProject = await world.create('project').with({
        name: 'Recreated cleanup target',
        slug: originalProject.slug,
        team: current.teams.genesisTeam.id,
        createdBy: current.users.genesisUser.id
      })
      const recreatedEnvironment = await world.create('environment').with({
        project: recreatedProject.id,
        name: 'Production',
        slug: 'production',
        isProduction: true
      })
      await world.create('app').with({
        environment: recreatedEnvironment.id,
        name: 'Web',
        slug: 'web'
      })

      const second = await sails.helpers.cleanup.run.with({
        targetKey: `project:${recreatedProject.id}`,
        requestKey,
        scopeType: 'project',
        resourceId: recreatedProject.id,
        retentionPolicy: 'retain',
        userId: current.users.genesisUser.id,
        teamId: current.teams.genesisTeam.id
      })

      expect(second.id === first.id).toBe(false)
      expect(second.targetKey).toBe(`project:${recreatedProject.id}`)
      expect(await sails.models.cleanupoperation.count({ requestKey })).toBe(2)
    })
  }
)

test(
  'cleanup pauses on a Caddy failure and resumes without losing records',
  { world: cleanupWorld('cleanup-caddy-retry') },
  async ({ sails, world, expect }) => {
    const current = world.current
    const project = current.projects.deploymentTarget
    const environment = current.environments.production
    let attempts = 0

    await withCleanupStubs(
      sails,
      {
        removeRoute: async () => {
          attempts += 1
          if (attempts === 1) {
            const error = new Error('Caddy is temporarily unavailable')
            error.code = 'CADDY_UNAVAILABLE'
            throw error
          }
          return { removed: true }
        }
      },
      async () => {
        const inputs = {
          targetKey: `environment:${project.slug}/${environment.slug}`,
          scopeType: 'environment',
          resourceId: environment.id,
          retentionPolicy: 'retain',
          userId: current.users.genesisUser.id,
          teamId: current.teams.genesisTeam.id
        }
        const error = await captureError(sails.helpers.cleanup.run.with(inputs))
        const failed = await sails.models.cleanupoperation.findOne({
          targetKey: inputs.targetKey
        })

        expect(error.code).toBe('CADDY_UNAVAILABLE')
        expect(failed.status).toBe('failed')
        expect(failed.stage).toBe('traffic')
        expect(
          Boolean(
            await sails.models.environment.findOne({ id: environment.id })
          )
        ).toBe(true)

        const blocked = await captureError(
          sails.helpers.deploy.queueDeployment.with({
            values: {
              environment: environment.id,
              triggeredBy: current.users.genesisUser.id,
              triggerType: 'manual'
            },
            app: current.apps.web,
            dispatch: false
          })
        )
        expect(blocked.code).toBe('cleanupInProgress')

        const resumed = await sails.helpers.cleanup.run.with(inputs)
        expect(resumed.status).toBe('complete')
        expect(resumed.warnings.length).toBe(1)
        expect(resumed.stages.traffic.status).toBe('complete')
        expect(attempts).toBe(2)
      }
    )
  }
)

test(
  'retain policy preserves service recovery artifacts while deleting records',
  { world: cleanupWorld('cleanup-retain') },
  async ({ sails, world, expect }) => {
    const current = world.current
    const environment = current.environments.production
    const service = await world.create('service').with({
      environment: environment.id,
      name: 'retained-db',
      status: 'running',
      containerName: 'slipway-cleanup-retained-db',
      envVarKey: 'DATABASE_URL',
      imageMetadata: { volumeName: 'cleanup-retained-volume' }
    })
    await sails.models.environment.updateOne({ id: environment.id }).set({
      envVars: {
        DATABASE_URL: 'postgres://retained',
        APP_NAME: 'Slipway'
      }
    })
    const backup = await world.create('backup').with({
      service: service.id,
      status: 'completed',
      s3Key: 'backups/cleanup-retain.sql'
    })

    await withCleanupStubs(sails, {}, async (calls) => {
      const result = await sails.helpers.cleanup.run.with({
        targetKey: `service:${service.id}`,
        scopeType: 'service',
        resourceId: service.id,
        retentionPolicy: 'retain',
        userId: current.users.genesisUser.id,
        teamId: current.teams.genesisTeam.id
      })
      const updatedEnvironment = await sails.models.environment
        .findOne({ id: environment.id })
        .decrypt()

      expect(result.status).toBe('complete')
      expect(result.retainedArtifacts.volumeNames).toContain(
        'cleanup-retained-volume'
      )
      expect(result.retainedArtifacts.backupObjects).toEqual([
        { backupId: backup.id, s3Key: backup.s3Key }
      ])
      expect(calls.removeVolume.length).toBe(0)
      expect(calls.deleteBackupObject.length).toBe(0)
      expect(updatedEnvironment.envVars.DATABASE_URL).toBe(undefined)
      expect(updatedEnvironment.envVars.APP_NAME).toBe('Slipway')
      expect(await sails.models.service.findOne({ id: service.id })).toBe(
        undefined
      )
      expect(await sails.models.backup.findOne({ id: backup.id })).toBe(
        undefined
      )
    })
  }
)

test(
  'a service cleanup does not block unrelated deployment work',
  { world: cleanupWorld('cleanup-service-scope') },
  async ({ sails, world, expect }) => {
    const current = world.current
    const environment = current.environments.production
    const service = await world.create('service').with({
      environment: environment.id,
      name: 'scoped-db',
      status: 'running',
      containerName: 'slipway-cleanup-scoped-db'
    })

    await withCleanupStubs(
      sails,
      {
        stopContainer: async () => {
          throw new Error('Docker is temporarily unavailable')
        }
      },
      async () => {
        const cleanupError = await captureError(
          sails.helpers.cleanup.run.with({
            targetKey: `service:${service.id}`,
            scopeType: 'service',
            resourceId: service.id,
            retentionPolicy: 'retain',
            userId: current.users.genesisUser.id,
            teamId: current.teams.genesisTeam.id
          })
        )
        expect(cleanupError.cleanup.status).toBe('failed')

        const queued = await sails.helpers.deploy.queueDeployment.with({
          values: {
            environment: environment.id,
            triggeredBy: current.users.genesisUser.id,
            triggerType: 'manual'
          },
          app: current.apps.web,
          dispatch: false
        })
        expect(queued.state).toBe('queued')

        const serviceBlock = await captureError(
          sails.helpers.cleanup.assertAvailable.with({
            serviceId: service.id
          })
        )
        expect(serviceBlock.code).toBe('blocked')
      }
    )
  }
)

test(
  'purge policy removes volumes, backups, images, and project source',
  { world: cleanupWorld('cleanup-purge') },
  async ({ sails, world, expect }) => {
    const current = world.current
    const project = current.projects.deploymentTarget
    const environment = current.environments.production
    const app = await sails.models.app
      .updateOne({ id: current.apps.web.id })
      .set({
        containerName: 'slipway-cleanup-purge-web',
        imageName: 'slipway/cleanup-purge:current'
      })
    const service = await world.create('service').with({
      environment: environment.id,
      name: 'purged-db',
      status: 'running',
      containerName: 'slipway-cleanup-purge-db',
      imageMetadata: { volumeName: 'cleanup-purge-volume' }
    })
    await world.create('backup').with({
      service: service.id,
      status: 'completed',
      s3Key: 'backups/cleanup-purge.sql'
    })
    await world.create('deployment').with({
      environment: environment.id,
      app: app.id,
      imageName: 'slipway/cleanup-purge:release'
    })

    await withCleanupStubs(sails, {}, async (calls) => {
      const result = await sails.helpers.cleanup.run.with({
        targetKey: `project:${project.slug}`,
        scopeType: 'project',
        resourceId: project.id,
        retentionPolicy: 'purge',
        userId: current.users.genesisUser.id,
        teamId: current.teams.genesisTeam.id
      })

      expect(result.status).toBe('complete')
      expect(calls.deleteBackupObject).toEqual(['backups/cleanup-purge.sql'])
      expect(calls.removeVolume).toContain('cleanup-purge-volume')
      expect(calls.removeImage).toContain('slipway/cleanup-purge:current')
      expect(calls.removeImage).toContain('slipway/cleanup-purge:release')
      expect(calls.removeSource.length).toBe(1)
      expect(result.retainedArtifacts).toEqual({})
    })
  }
)

async function withCleanupStubs(sails, overrides, run) {
  const originals = {
    removeRoute: sails.helpers.caddy.removeRoute,
    updateRoute: sails.helpers.caddy.updateRoute,
    stopContainer: sails.helpers.docker.stopContainer,
    removeVolume: sails.helpers.docker.removeVolume,
    removeImage: sails.helpers.docker.removeImage,
    deleteBackupObject: sails.helpers.backup.deleteBackupObject,
    cleanupBuildContext: sails.helpers.deploy.cleanupBuildContext,
    removeSource: sails.helpers.cleanup.removeSource
  }
  const calls = {
    removeRoute: [],
    updateRoute: [],
    stopContainer: [],
    removeVolume: [],
    removeImage: [],
    deleteBackupObject: [],
    cleanupBuildContext: [],
    removeSource: []
  }
  const defaults = {
    removeRoute: async (inputs) => ({ removed: true, ...inputs }),
    updateRoute: async () => ({ action: 'updated' }),
    stopContainer: async () => ({ stopped: true }),
    removeVolume: async () => ({ removed: true }),
    removeImage: async () => ({ removed: true }),
    deleteBackupObject: async () => ({}),
    cleanupBuildContext: async () => ({ removed: false }),
    removeSource: async () => ({ removed: true })
  }

  for (const [name, original] of Object.entries(originals)) {
    const implementation = overrides[name] || defaults[name]
    const stub = async (inputs) => {
      if (name === 'removeVolume') calls[name].push(inputs.volumeName)
      else if (name === 'removeImage') calls[name].push(inputs.imageName)
      else if (name === 'deleteBackupObject') calls[name].push(inputs.s3Key)
      else calls[name].push(inputs)
      return implementation(inputs)
    }
    stub.with = stub
    setHelper(sails, name, stub)
    originals[name] = original
  }

  try {
    return await run(calls)
  } finally {
    for (const [name, original] of Object.entries(originals)) {
      setHelper(sails, name, original)
    }
  }
}

function setHelper(sails, name, helper) {
  const namespaces = {
    removeRoute: sails.helpers.caddy,
    updateRoute: sails.helpers.caddy,
    stopContainer: sails.helpers.docker,
    removeVolume: sails.helpers.docker,
    removeImage: sails.helpers.docker,
    deleteBackupObject: sails.helpers.backup,
    cleanupBuildContext: sails.helpers.deploy,
    removeSource: sails.helpers.cleanup
  }
  namespaces[name][name] = helper
}

async function captureError(promise) {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('Expected cleanup to fail')
}
