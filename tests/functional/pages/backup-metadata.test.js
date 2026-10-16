const { test } = require('sounding')
const { createSessionCookie } = require('sounding/lib/create-session-cookie')
const { withCsrfFromPage } = require('../../support/csrf-request')
const assert = require('node:assert/strict')
const fs = require('node:fs')

test(
  'backup metadata stays bounded, fresh and scoped on environment and app pages',
  {
    transport: 'http',
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'backup-metadata' } }
    }
  },
  async ({ sails, world, request, expect }) => {
    const env = world.current.environments.production
    const project = world.current.projects.deploymentTarget
    const app = world.current.apps.web
    const cookie = await createSessionCookie(sails, {
      userId: world.current.users.genesisUser.id
    })
    const browser = await withCsrfFromPage(
      request.using('http').withHeaders({ cookie }),
      '/'
    )
    const services = []
    const expected = new Map()
    const measurements = []
    for (const count of [1, 10, 50]) {
      while (services.length < count) {
        const service = await world
          .create('service')
          .with({ environment: env.id })
        services.push(service)
        // Include timestamp ties and historical records; match the existing ORM's choice.
        await sails.models.backup.createEach(
          Array.from({ length: 24 }, (_, i) => ({
            service: service.id,
            status: i % 4 === 0 ? 'completed' : 'failed',
            createdAt: 1000 + Math.floor(i / 2),
            completedAt: i % 4 === 0 ? 2000 + i : null,
            sizeBytes: i,
            errorMessage: 'Fixture only'
          }))
        )
        const latest = (
          await sails.models.backup
            .find({ service: service.id })
            .sort('createdAt DESC')
            .limit(1)
        )[0]
        const success =
          latest.status === 'completed'
            ? latest
            : (
                await sails.models.backup
                  .find({ service: service.id, status: 'completed' })
                  .sort('completedAt DESC')
                  .limit(1)
              )[0]
        expected.set(service.id, { latest, success })
      }
      for (const suffix of ['', `/apps/${app.slug}`]) {
        const datastore = sails.getDatastore()
        const originalNative = datastore.sendNativeQuery
        const originalFind = sails.models.backup.find
        let nativeReads = 0,
          ormReads = 0,
          returnedRows = 0
        datastore.sendNativeQuery = function (sql, ...args) {
          const result = originalNative.call(this, sql, ...args)
          if (!/FROM backups/i.test(sql)) return result
          nativeReads++
          return result.then((value) => {
            returnedRows += value.rows.length
            return value
          })
        }
        sails.models.backup.find = function (...args) {
          ormReads++
          return originalFind.apply(this, args)
        }
        const times = []
        try {
          for (let i = 0; i < 3; i++) {
            const started = performance.now()
            const response = await browser.request.get(
              `/projects/${project.slug}/environments/${env.slug}${suffix}`
            )
            times.push(Number((performance.now() - started).toFixed(2)))
            expect(response).toBeInertiaPage(
              suffix ? 'projects/app' : 'projects/environment'
            )
            for (const service of response.data.props.environment.services) {
              const { latest, success } = expected.get(service.id)
              assert.deepEqual(service.lastBackup, {
                id: latest.id,
                status: latest.status,
                completedAt: latest.completedAt,
                sizeBytes: latest.sizeBytes
              })
              if (!suffix)
                assert.deepEqual(service.lastSuccessfulBackup, {
                  completedAt: success.completedAt,
                  sizeBytes: success.sizeBytes
                })
              assert.equal('errorMessage' in service.lastBackup, false)
            }
          }
          if (!process.env.BACKUP_METADATA_BASELINE) {
            assert.equal(ormReads, 0)
            assert.equal(nativeReads, 3)
            assert.ok(returnedRows <= count * 2 * 3)
          }
          measurements.push({
            count,
            page: suffix ? 'app' : 'environment',
            ormReads: ormReads / 3,
            nativeReads: nativeReads / 3,
            returnedRows: returnedRows / 3,
            localhostHttpMs: times
          })
        } finally {
          datastore.sendNativeQuery = originalNative
          sails.models.backup.find = originalFind
        }
      }
    }
    if (!process.env.BACKUP_METADATA_BASELINE) {
      const service = services[0]
      for (const status of ['pending', 'running', 'failed', 'completed']) {
        const latest = await sails.models.backup
          .create({
            service: service.id,
            status,
            createdAt: Date.now(),
            completedAt: status === 'completed' ? 1 : null,
            sizeBytes: 99
          })
          .fetch()
        const response = await browser.request.get(
          `/projects/${project.slug}/environments/${env.slug}`
        )
        const actual = response.data.props.environment.services.find(
          (item) => item.id === service.id
        )
        assert.equal(actual.lastBackup.id, latest.id)
        assert.equal(actual.lastBackup.status, status)
        if (status === 'completed')
          assert.equal(actual.lastSuccessfulBackup.completedAt, 1)
      }
      const empty = await world.create('service').with({ environment: env.id })
      const unsupported = await world
        .create('service')
        .with({ environment: env.id, type: 'redis' })
      const response = await browser.request.get(
        `/projects/${project.slug}/environments/${env.slug}`
      )
      for (const id of [empty.id, unsupported.id]) {
        const actual = response.data.props.environment.services.find(
          (item) => item.id === id
        )
        assert.equal(actual.lastBackup, null)
        assert.equal(actual.lastSuccessfulBackup, null)
      }
      const foreignTeam = await world
        .create('team')
        .with({ owner: world.current.users.genesisUser.id })
      const foreignProject = await world
        .create('project')
        .with({
          team: foreignTeam.id,
          createdBy: world.current.users.genesisUser.id
        })
      const foreignEnv = await world
        .create('environment')
        .with({ project: foreignProject.id })
      const foreignService = await world
        .create('service')
        .with({ environment: foreignEnv.id })
      const foreignBackup = await sails.models.backup
        .create({
          service: foreignService.id,
          status: 'completed',
          sizeBytes: 123456
        })
        .fetch()
      const helperResult = await sails.helpers.backup.getLatestMetadata([
        service.id
      ])
      assert.equal(helperResult[foreignService.id], undefined)
      assert.ok(
        !JSON.stringify(helperResult).includes(`"id":${foreignBackup.id}`)
      )
      const denied = await browser.request.get(
        `/projects/${foreignProject.slug}/environments/${foreignEnv.slug}`
      )
      expect(denied).toRedirectTo('/')
      const datastore = sails.getDatastore()
      const originalNative = datastore.sendNativeQuery
      let backupReads = 0
      datastore.sendNativeQuery = function (sql, ...args) {
        if (/FROM backups/i.test(sql)) backupReads++
        return originalNative.call(this, sql, ...args)
      }
      try {
        for (const suffix of ['', `/apps/${app.slug}`]) {
          await browser.request.get(
            `/projects/${project.slug}/environments/${env.slug}${suffix}`,
            {
              headers: {
                'X-Inertia-Partial-Component': suffix
                  ? 'projects/app'
                  : 'projects/environment',
                'X-Inertia-Partial-Data': 'deployments'
              }
            }
          )
        }
        assert.equal(backupReads, 0)
        assert.deepEqual(await sails.helpers.backup.getLatestMetadata([]), {})
        assert.equal(backupReads, 0)
      } finally {
        datastore.sendNativeQuery = originalNative
      }
    }
    fs.mkdirSync('.tmp/audit', { recursive: true })
    fs.writeFileSync(
      `.tmp/audit/793-${process.env.BACKUP_METADATA_BASELINE ? 'before' : 'after'}.json`,
      JSON.stringify(measurements, null, 2)
    )
  }
)
