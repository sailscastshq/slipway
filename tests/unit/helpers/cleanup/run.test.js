const { test } = require('sounding')
const assert = require('node:assert/strict')
const recovery = require('../../../../api/lib/deployment-recovery')
const { prepare, image } = require('../../../support/recovery-fixture')

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
      s3Key: 'backups/cleanup-retain.sql',
      storageCredentials: {
        provider: 's3',
        bucket: 'backups',
        key: 'access',
        secret: 'private'
      }
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
        { backupId: backup.id, objectKey: backup.s3Key }
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
      s3Key: 'backups/cleanup-purge.sql',
      storageCredentials: {
        provider: 's3',
        bucket: 'backups',
        key: 'access',
        secret: 'private'
      }
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
      expect(calls.removeSource.length).toBe(2)
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
      else if (name === 'deleteBackupObject')
        calls[name].push(inputs.objectKey || inputs.s3Key)
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

test(
  'cleanup pauses before traffic removal during restore and blocks new restores',
  { world: cleanupWorld('cleanup-restore-exclusion') },
  async ({ sails, world, expect }) => {
    const current = world.current
    const project = current.projects.deploymentTarget
    const service = await world.create('service').with({
      environment: current.environments.production.id,
      name: 'restoring-db',
      status: 'restoring'
    })
    const backup = await world.create('backup').with({
      service: service.id,
      status: 'completed',
      s3Key: 'restore-fixture.sql',
      storageCredentials: {
        provider: 's3',
        bucket: 'backups',
        key: 'access',
        secret: 'private'
      }
    })
    const inputs = {
      targetKey: `project:${project.id}`,
      scopeType: 'project',
      resourceId: project.id,
      teamId: current.teams.genesisTeam.id,
      userId: current.users.genesisUser.id
    }
    await withCleanupStubs(sails, {}, async (calls) => {
      let failure
      try {
        await sails.helpers.cleanup.run.with(inputs)
      } catch (error) {
        failure = error
      }
      expect(failure.message.includes('restore is active')).toBe(true)
      expect(calls.removeRoute.length).toBe(0)
      expect(calls.stopContainer.length).toBe(0)
      await sails.models.service
        .updateOne({ id: service.id })
        .set({ status: 'running' })
      let admission
      try {
        await require('../../../../api/lib/restore-operations').enqueue({
          service,
          backup,
          teamId: inputs.teamId,
          userId: inputs.userId
        })
      } catch (error) {
        admission = error
      }
      expect(admission.message.includes('Cleanup is pending')).toBe(true)
      expect(
        (await sails.models.service.findOne({ id: service.id })).status
      ).toBe('running')
      expect((await sails.helpers.cleanup.run.with(inputs)).status).toBe(
        'complete'
      )
    })
  }
)

for (const scopeType of ['app', 'environment', 'project']) {
  for (const retentionPolicy of ['retain', 'purge']) {
    test(
      `recovery metadata ${scopeType} deletion ${retentionPolicy} preserves scope and retention continuity`,
      {
        world: cleanupWorld(`recovery-delete-${scopeType}-${retentionPolicy}`)
      },
      async ({ sails, world }) => {
        const setup = await prepare({ sails, world })
        try {
          const extra = await unrelatedRecoveryApp(sails, world)
          const pending = await world.create('deployment').with({
            app: setup.app.id,
            environment: setup.environment.id,
            status: 'failed'
          })
          const intentKey = `rollbackIntent:v1:${pending.id}`
          await sails.models.setting.create({
            key: intentKey,
            value: JSON.stringify({
              appId: setup.app.id,
              environmentId: setup.environment.id,
              imageId: image(3)
            })
          })
          const inputs = recoveryCleanupInputs(
            world,
            scopeType,
            retentionPolicy
          )
          await withCleanupStubs(sails, {}, async () => {
            const result = await sails.helpers.cleanup.run.with(inputs)
            assert.equal(result.status, 'complete')
            assert.equal(
              await sails.models.app.findOne({ id: setup.app.id }),
              undefined
            )
            assert.equal(
              await sails.models.setting.findOne({
                key: recovery.key(setup.app.id)
              }),
              undefined
            )
            assert.equal(
              await sails.models.setting.findOne({ key: intentKey }),
              undefined
            )
            assert.ok(
              await sails.models.setting.findOne({
                key: recovery.key(extra.app.id)
              })
            )
            const operation = await sails.models.cleanupoperation.findOne({
              id: result.id
            })
            assert.deepEqual(
              new Set(operation.snapshot.artifacts.recoveryImageIds),
              new Set([image(1), image(2), image(3)])
            )
            const plan = await recoveryRetentionPlan(sails, setup, extra)
            assert.equal(plan.status, 'planned', plan.holds.join('; '))
            assert.ok(
              plan.candidates.some((candidate) => candidate.id === image(9))
            )
            if (retentionPolicy === 'retain') {
              for (const id of [image(1), image(2), image(3)])
                assert.ok(
                  plan.protected
                    .find((candidate) => candidate.id === id)
                    .reasons.includes('retained-recovery')
                )
              assert.deepEqual(
                new Set(result.retainedArtifacts.recoveryImageIds),
                new Set([image(1), image(2), image(3)])
              )
            } else assert.deepEqual(result.retainedArtifacts, {})
            assert.equal(
              (await sails.helpers.cleanup.run.with(inputs)).id,
              result.id
            )
          })
        } finally {
          setup.restore()
        }
      }
    )
  }
}

test(
  'recovery metadata deletion rolls back settings and refreshed snapshot on transaction failure then retries safely',
  { world: cleanupWorld('recovery-delete-transaction') },
  async ({ sails, world }) => {
    const setup = await prepare({ sails, world })
    const originalDestroy = sails.models.app.destroy
    const originalRecords = sails.helpers.cleanup.removeRecords
    const inputs = recoveryCleanupInputs(world, 'project', 'retain')
    try {
      let refreshed = false
      sails.helpers.cleanup.removeRecords = {
        with: async (input) => {
          if (!refreshed) {
            refreshed = true
            const next = structuredClone(setup.state)
            next.previous.imageId = image(3)
            await sails.models.setting
              .updateOne({ key: recovery.key(setup.app.id) })
              .set({ value: JSON.stringify(next) })
          }
          return originalRecords.with(input)
        }
      }
      sails.models.app.destroy = () => {
        throw new Error('Safe fixture: record transaction failure')
      }
      await withCleanupStubs(sails, {}, async () => {
        const failure = await captureError(
          sails.helpers.cleanup.run.with(inputs)
        )
        assert.match(failure.message, /record transaction failure/)
        assert.ok(await sails.models.app.findOne({ id: setup.app.id }))
        assert.equal(
          JSON.parse(
            (
              await sails.models.setting.findOne({
                key: recovery.key(setup.app.id)
              })
            ).value
          ).previous.imageId,
          image(3)
        )
        const failed = await sails.models.cleanupoperation.findOne({
          targetKey: inputs.targetKey
        })
        assert.deepEqual(
          new Set(failed.snapshot.artifacts.recoveryImageIds),
          new Set([image(1), image(2)])
        )
        sails.models.app.destroy = originalDestroy
        const result = await sails.helpers.cleanup.run.with(inputs)
        assert.equal(result.status, 'complete')
        const complete = await sails.models.cleanupoperation.findOne({
          id: result.id
        })
        assert.deepEqual(
          new Set(complete.snapshot.artifacts.recoveryImageIds),
          new Set([image(1), image(2), image(3)])
        )
        assert.equal(
          await sails.models.setting.findOne({
            key: recovery.key(setup.app.id)
          }),
          undefined
        )
        // Simulate a crash after the record transaction committed but before the
        // stage completion was persisted: replay the same durable record stage.
        await originalRecords.with({
          snapshot: complete.snapshot,
          operationId: complete.id
        })
        assert.deepEqual(
          new Set(
            (
              await sails.models.cleanupoperation.findOne({ id: complete.id })
            ).snapshot.artifacts.recoveryImageIds
          ),
          new Set([image(1), image(2), image(3)])
        )
      })
    } finally {
      sails.models.app.destroy = originalDestroy
      sails.helpers.cleanup.removeRecords = originalRecords
      setup.restore()
    }
  }
)

test(
  'recovery metadata deletion refuses operator holds and mismatched metadata before removing traffic',
  { world: cleanupWorld('recovery-delete-held') },
  async ({ sails, world }) => {
    const setup = await prepare({ sails, world })
    const holdKey = recovery.HOLD_PREFIX + setup.app.id
    try {
      await sails.models.setting.create({ key: holdKey, value: '{}' })
      await withCleanupStubs(sails, {}, async (calls) => {
        const failure = await captureError(
          sails.helpers.cleanup.run.with(
            recoveryCleanupInputs(world, 'project', 'retain')
          )
        )
        assert.match(failure.message, /operator inspection/)
        assert.equal(calls.removeRoute.length, 0)
        assert.equal(calls.stopContainer.length, 0)
        assert.ok(await sails.models.setting.findOne({ key: holdKey }))
        await sails.models.setting.destroy({ key: holdKey })
        const invalid = { ...setup.state, environmentId: '999999' }
        await sails.models.setting
          .updateOne({ key: recovery.key(setup.app.id) })
          .set({ value: JSON.stringify(invalid) })
        const mismatch = await captureError(
          sails.helpers.cleanup.run.with(
            recoveryCleanupInputs(world, 'project', 'retain')
          )
        )
        assert.match(mismatch.message, /does not match/)
        assert.equal(calls.removeRoute.length, 0)
        assert.ok(await sails.models.app.findOne({ id: setup.app.id }))
      })
    } finally {
      setup.restore()
    }
  }
)

function recoveryCleanupInputs(world, scopeType, retentionPolicy) {
  const current = world.current
  const resourceId =
    scopeType === 'app'
      ? current.apps.web.id
      : scopeType === 'environment'
      ? current.environments.production.id
      : current.projects.deploymentTarget.id
  return {
    scopeType,
    resourceId,
    targetKey: `${scopeType}:${resourceId}`,
    retentionPolicy,
    userId: current.users.genesisUser.id,
    teamId: current.teams.genesisTeam.id
  }
}

async function unrelatedRecoveryApp(sails, world) {
  const project = await world.create('project').with({
    name: 'Unrelated',
    slug: `unrelated-recovery-${world.current.apps.web.id}`,
    team: world.current.teams.genesisTeam.id,
    createdBy: world.current.users.genesisUser.id
  })
  const environment = await world
    .create('environment')
    .with({ project: project.id, name: 'Production', slug: 'production' })
  const app = await world
    .create('app')
    .with({ environment: environment.id, name: 'Other', slug: 'web' })
  const current = await world.create('deployment').with({
    app: app.id,
    environment: environment.id,
    status: 'running',
    imageId: image(8),
    imageName: 'slipway/unrelated-production-web:current'
  })
  await sails.models.app.updateOne({ id: app.id }).set({
    currentDeployment: current.id,
    imageId: image(8),
    imageName: current.imageName
  })
  await sails.models.setting.create({
    key: recovery.key(app.id),
    value: JSON.stringify({
      version: 1,
      appId: String(app.id),
      environmentId: String(environment.id),
      current: {
        deploymentId: String(current.id),
        imageId: image(8),
        compatibility: null,
        promotedAt: Date.now()
      },
      previous: null,
      rejectedImages: []
    })
  })
  const failed = await world.create('deployment').with({
    app: app.id,
    environment: environment.id,
    status: 'failed',
    imageId: image(9)
  })
  failed.imageName = `slipway/unrelated-production-web:${failed.id}`
  await sails.models.deployment
    .updateOne({ id: failed.id })
    .set({ imageName: failed.imageName })
  return { app, current, failed }
}

async function recoveryRetentionPlan(sails, setup, extra) {
  const images = [
    [1, setup.previous.imageName],
    [2, setup.current.imageName],
    [3, null],
    [8, extra.current.imageName],
    [9, extra.failed.imageName]
  ].map(([number, tag]) => ({
    id: image(number),
    tags: tag ? [tag] : [],
    digests: [],
    size: 1,
    created: '2020-01-01T00:00:00Z'
  }))
  // Project only this test's persisted records into the planner. Sounding keeps
  // earlier worlds' retained artifacts in the same database; they are not part
  // of this fixture's deliberately bounded Docker inventory.
  const appIds = [setup.app.id, extra.app.id]
  const deploymentIds = [
    setup.previous.id,
    setup.current.id,
    extra.current.id,
    extra.failed.id
  ]
  const rows = {
    App: await sails.models.app.find({ id: { in: appIds } }),
    Deployment: await sails.models.deployment.find({
      id: { in: deploymentIds }
    }),
    Setting: await sails.models.setting.find({
      key: { in: appIds.map(recovery.key) }
    }),
    CleanupOperation: (await sails.models.cleanupoperation.find()).filter(
      (operation) => operation.snapshot.records.appIds.includes(setup.app.id)
    ),
    Service: [],
    DeploymentJob: []
  }
  const originals = Object.fromEntries(
    Object.keys(rows).map((name) => [name, global[name]])
  )
  try {
    for (const [name, records] of Object.entries(rows))
      global[name] = {
        find: () => ({ select: () => ({ limit: async () => records }) })
      }
    return await require('../../../../api/helpers/image-retention/get-plan').fn(
      {
        inventory: { images, containers: [] },
        policy: await sails.helpers.imageRetention.getPolicy(),
        now: Date.now()
      }
    )
  } finally {
    Object.assign(global, originals)
  }
}

test(
  'recovery metadata resource deletion waits for the shared image retention guard',
  { world: cleanupWorld('recovery-delete-guard') },
  async ({ sails, world }) => {
    const release =
      await require('../../../../api/lib/image-operation-guard').acquire(
        sails.config.appPath,
        'cleanup'
      )
    try {
      await withCleanupStubs(sails, {}, async (calls) => {
        const error = await captureError(
          sails.helpers.cleanup.run.with(
            recoveryCleanupInputs(world, 'project', 'retain')
          )
        )
        assert.equal(error.code, 'E_IMAGE_OPERATIONS_BUSY')
        assert.equal(calls.removeRoute.length, 0)
        assert.ok(
          await sails.models.app.findOne({ id: world.current.apps.web.id })
        )
      })
    } finally {
      await release()
    }
  }
)
