const { test } = require('sounding')
const provisioning = require('../../../api/lib/service-provisioning')
const owners = require('../../../api/lib/service-provisioning-owner')
const artifacts = require('../../../api/lib/service-provisioning-docker')
const { withCsrfFromPage } = require('../../support/csrf-request')

test(
  'retry serializes provisioners, retains credentials and atomically finishes managed config and audit',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'provisioning' } }
    }
  },
  async ({ sails, world, expect, request }) => {
    const originals = {
      current: owners.current,
      dead: owners.dead,
      reconcile: artifacts.reconcile,
      verify: artifacts.verifyCredentials,
      resolve: sails.helpers.docker.resolveServiceImage,
      run: sails.helpers.docker.runServiceContainer,
      wait: sails.helpers.docker.waitForService
    }
    let release, entered
    const waiting = new Promise((resolve) => {
      release = resolve
    })
    const inRun = new Promise((resolve) => {
      entered = resolve
    })
    owners.current = async () => ({
      instance: 'fixture-current',
      legacySafe: true,
      container: {
        running: true,
        startedAt: new Date(Date.now() - 1000).toISOString()
      }
    })
    owners.dead = async () => false
    artifacts.verifyCredentials = async () => true
    artifacts.reconcile = async () => null
    const replace = (key, fn) => {
      fn.with = fn
      sails.helpers.docker[key] = fn
    }
    replace('resolveServiceImage', async () => ({
      imageReference: 'postgres@sha256:fixed',
      imageTag: 'postgres:17'
    }))
    replace(
      'runServiceContainer',
      async ({ service, containerName, imageReference, volumeName }) => {
        expect(service.password).toBe('stored-fixture-password')
        entered()
        await waiting
        return {
          containerId: 'same-record-container',
          containerName,
          imageReference,
          volumeName
        }
      }
    )
    replace('waitForService', async () => ({ ready: true }))
    try {
      const service = await world.create('service').with({
        name: 'db',
        version: '17',
        status: 'creating',
        createdAt: Date.now() - 10000,
        environment: world.current.environments.production.id,
        containerName: 'slipway-provisioning-production-db',
        internalHost: 'slipway-provisioning-production-db',
        internalPort: 5432,
        username: 'original-user',
        password: 'stored-fixture-password',
        database: 'db'
      })
      const args = {
        serviceId: service.id,
        retry: true,
        actor: {
          userId: String(world.current.users.genesisUser.id),
          teamId: String(world.current.teams.genesisTeam.id),
          userName: 'Fixture user'
        }
      }
      const first = provisioning.provision(args)
      await inRun
      let rejected = false
      try {
        await provisioning.provision(args)
      } catch (e) {
        rejected = e.code === 'PROVISIONING_CONFLICT'
      }
      expect(rejected).toBe(true)
      expect((await sails.models.service.findOne(service.id)).status).toBe(
        'creating'
      )
      release()
      await first
      const saved = await sails.models.service.findOne(service.id).decrypt()
      expect(saved.password).toBe('stored-fixture-password')
      expect(saved.username).toBe('original-user')
      expect(saved.status).toBe('running')
      expect(saved.envVarKey).toBe('DATABASE_URL')
      expect(
        await sails.models.service.count({ environment: saved.environment })
      ).toBe(1)
      const env = await sails.models.environment
        .findOne(saved.environment)
        .decrypt()
      expect(env.envVars.DATABASE_URL).toBe(
        await sails.models.service.getConnectionUrl(service.id)
      )
      expect(env.envVarMetadata.DATABASE_URL.managed).toBe(true)
      expect(env.envVarMetadata.DATABASE_URL.previewPolicy).toBe('omit')
      expect(
        await sails.models.auditlog.count({
          action: 'service.provisioning.recovered',
          resourceId: String(service.id)
        })
      ).toBe(1)
      const dashboard = await withCsrfFromPage(
        request,
        '/projects/provisioning/environments/production',
        'genesisUser'
      )
      expect(
        await dashboard.request.post(
          `/api/v1/services/${service.id}/retry-provisioning`
        )
      ).toHaveStatus(409)
    } finally {
      release()
      owners.current = originals.current
      owners.dead = originals.dead
      artifacts.reconcile = originals.reconcile
      artifacts.verifyCredentials = originals.verify
      sails.helpers.docker.resolveServiceImage = originals.resolve
      sails.helpers.docker.runServiceContainer = originals.run
      sails.helpers.docker.waitForService = originals.wait
    }
  }
)

test(
  'interruption after container start retries by adoption; conflicting variables roll back without fabricated success',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'provisioning-resume' } }
    }
  },
  async ({ sails, world, expect }) => {
    const originals = {
      current: owners.current,
      dead: owners.dead,
      reconcile: artifacts.reconcile,
      verify: artifacts.verifyCredentials,
      wait: sails.helpers.docker.waitForService,
      auditCreate: sails.models.auditlog.create
    }
    owners.current = async () => ({ instance: 'new-runtime' })
    owners.dead = async () => true
    const auditBefore = await sails.models.auditlog.count({
      action: 'service.provisioning.recovered'
    })
    let credentialsValid = true
    artifacts.verifyCredentials = async () => {
      if (!credentialsValid) throw new Error('invalid original-password')
    }
    let adopts = 0
    artifacts.reconcile = async (s) => {
      adopts++
      return {
        containerId: 'retained-container',
        containerName: s.containerName,
        volumeName: 'retained-volume',
        imageReference: s.imageReference
      }
    }
    const wait = async () => ({ ready: true })
    wait.with = wait
    sails.helpers.docker.waitForService = wait
    try {
      const envId = world.current.environments.production.id
      await sails.models.environment.updateOne(envId).set({
        envVars: {
          DATABASE_URL: 'existing-user-configuration',
          DB_URL: 'also-occupied'
        }
      })
      const service = await world.create('service').with({
        name: 'db',
        status: 'creating',
        environment: envId,
        password: 'original-password',
        username: 'original-user',
        database: 'db',
        containerName: 'retained-container',
        internalHost: 'retained-container',
        internalPort: 5432,
        imageReference: 'postgres@sha256:retained',
        imageMetadata: {
          volumeName: 'retained-volume',
          provisioning: {
            version: 1,
            state: 'running',
            token: 'dead-token',
            owner: { instance: 'dead-runtime' }
          }
        }
      })
      const args = {
        serviceId: service.id,
        retry: true,
        actor: {
          userId: String(world.current.users.genesisUser.id),
          teamId: String(world.current.teams.genesisTeam.id)
        }
      }
      let conflict = false
      try {
        await provisioning.provision(args)
      } catch (e) {
        conflict = e.code === 'PROVISIONING_CONFLICT'
      }
      expect(conflict).toBe(true)
      expect((await sails.models.service.findOne(service.id)).status).toBe(
        'failed'
      )
      expect(
        await sails.models.auditlog.count({
          action: 'service.provisioning.recovered'
        })
      ).toBe(auditBefore)
      let env = await sails.models.environment.findOne(envId).decrypt()
      expect(env.envVars.DB_URL).toBe('also-occupied')
      expect(env.envVars.DATABASE_URL).toBe('existing-user-configuration')
      await sails.models.environment
        .updateOne(envId)
        .set({ envVars: { DATABASE_URL: 'existing-user-configuration' } })
      credentialsValid = false
      let authenticationRejected = false
      try {
        await provisioning.provision(args)
      } catch (error) {
        authenticationRejected = true
        expect(error.message.includes('original-password')).toBe(false)
      }
      expect(authenticationRejected).toBe(true)
      env = await sails.models.environment.findOne(envId).decrypt()
      expect(env.envVars.DB_URL).toBe(undefined)
      expect((await sails.models.service.findOne(service.id)).status).toBe(
        'failed'
      )
      credentialsValid = true
      let failAudit = true
      sails.models.auditlog.create = function (values) {
        if (failAudit && values.action === 'service.provisioning.recovered')
          return {
            usingConnection: async () => {
              throw new Error(
                'fixture transaction interruption original-password'
              )
            }
          }
        return originals.auditCreate.call(this, values)
      }
      let interrupted = false
      try {
        await provisioning.provision(args)
      } catch (error) {
        interrupted = true
        expect(error.message.includes('original-password')).toBe(false)
      }
      expect(interrupted).toBe(true)
      env = await sails.models.environment.findOne(envId).decrypt()
      expect(env.envVars.DB_URL).toBe(undefined)
      expect((await sails.models.service.findOne(service.id)).status).toBe(
        'failed'
      )
      failAudit = false
      await provisioning.provision(args)
      env = await sails.models.environment.findOne(envId).decrypt()
      expect(env.envVars.DATABASE_URL).toBe('existing-user-configuration')
      expect(env.envVars.DB_URL).toBe(
        await sails.models.service.getConnectionUrl(service.id)
      )
      const saved = await sails.models.service.findOne(service.id).decrypt()
      expect(saved.password).toBe('original-password')
      expect(saved.containerId).toBe('retained-container')
      expect(saved.status).toBe('running')
      expect(adopts).toBe(4)
      expect(
        await sails.models.auditlog.count({
          action: 'service.provisioning.recovered'
        })
      ).toBe(auditBefore + 1)
      const presented = sails.models.service.toPublic(saved)
      expect(presented.imageMetadata.provisioning).toBe(undefined)
    } finally {
      owners.current = originals.current
      owners.dead = originals.dead
      artifacts.reconcile = originals.reconcile
      artifacts.verifyCredentials = originals.verify
      sails.helpers.docker.waitForService = originals.wait
      sails.models.auditlog.create = originals.auditCreate
    }
  }
)

test(
  'retry endpoint denies other teams and active owners and cleanup excludes new claims',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'provisioning-access' } }
    }
  },
  async ({ sails, world, request, expect }) => {
    const original = owners.current
    owners.current = async () => ({ instance: 'fixture-current' })
    try {
      const service = await world.create('service').with({
        name: 'db',
        status: 'creating',
        environment: world.current.environments.production.id
      })
      const otherTeam = await world
        .create('team')
        .with({ owner: world.current.users.genesisUser.id })
      const otherUser = await world
        .create('user')
        .with({ team: otherTeam.id, teamRole: 'owner' })
      const foreign = await withCsrfFromPage(request, '/', otherUser)
      expect(
        await foreign.request.post(
          `/api/v1/services/${service.id}/retry-provisioning`
        )
      ).toHaveStatus(404)
      const own = await withCsrfFromPage(request, '/', 'genesisUser')
      expect(
        await own.request.post(
          `/api/v1/services/${service.id}/retry-provisioning`
        )
      ).toHaveStatus(409)
      await sails.models.cleanupoperation.create({
        targetKey: `service:${service.id}`,
        requestKey: `service:${service.id}`,
        scopeType: 'service',
        resourceId: String(service.id),
        serviceId: service.id,
        projectId: world.current.projects.deploymentTarget.id,
        team: world.current.teams.genesisTeam.id,
        status: 'pending',
        stage: 'pending',
        snapshot: {}
      })
      let blocked = false
      try {
        await provisioning.provision({ serviceId: service.id })
      } catch (e) {
        blocked = e.code === 'PROVISIONING_CONFLICT'
      }
      expect(blocked).toBe(true)
      expect(
        (await sails.models.service.findOne(service.id)).imageMetadata
          ?.provisioning
      ).toBe(undefined)
    } finally {
      owners.current = original
    }
  }
)

test(
  'simultaneous claims admit exactly one owner',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'provisioning-race' } }
    }
  },
  async ({ sails, world, expect }) => {
    const original = owners.current
    owners.current = async () => ({ instance: 'fixture-current' })
    try {
      const service = await world.create('service').with({
        name: 'db',
        status: 'creating',
        environment: world.current.environments.production.id
      })
      const results = await Promise.allSettled([
        provisioning._private.claim(service, false, {}),
        provisioning._private.claim(service, false, {})
      ])
      expect(
        results.filter((result) => result.status === 'fulfilled').length
      ).toBe(1)
      expect(
        results.filter((result) => result.status === 'rejected').length
      ).toBe(1)
      expect(
        (await sails.models.service.findOne(service.id)).imageMetadata
          .provisioning.token
      ).toBe(results.find((result) => result.status === 'fulfilled').value)
    } finally {
      owners.current = original
    }
  }
)

test(
  'legacy image discovery cannot overwrite a provisioning claim made during Docker inspection',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'provisioning-discovery' } }
    }
  },
  async ({ sails, world, expect }) => {
    const originalOwner = owners.current
    const originalInspect = sails.helpers.docker.inspectRunningServiceImage
    owners.current = async () => ({ instance: 'fixture-current' })
    try {
      const service = await world.create('service').with({
        name: 'db',
        status: 'creating',
        environment: world.current.environments.production.id,
        containerName: 'fixture-discovery-db'
      })
      let token
      const inspect = async () => {
        token = await provisioning._private.claim(service, false, {})
        return { imageReference: 'postgres@sha256:discovered', version: '16' }
      }
      inspect.with = inspect
      sails.helpers.docker.inspectRunningServiceImage = inspect
      await sails.helpers.service.migrateLegacyVersions()
      const saved = await sails.models.service.findOne(service.id)
      expect(saved.imageMetadata.provisioning.token).toBe(token)
      expect(saved.imageReference).toBe(null)
    } finally {
      owners.current = originalOwner
      sails.helpers.docker.inspectRunningServiceImage = originalInspect
    }
  }
)
