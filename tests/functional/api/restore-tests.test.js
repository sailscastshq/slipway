const { test } = require('sounding')
const { withCsrfFromPage } = require('../../support/csrf-request')
test(
  'backup restore tests are scoped, deduplicated, cancellable and never claim the live service',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'restore-tests' } }
    }
  },
  async ({ sails, world, request, expect }) => {
    const current = world.current
    const service = await world.create('service').with({
      environment: current.environments.production.id,
      name: 'test-db',
      status: 'running',
      type: 'postgresql',
      version: '15'
    })
    const backup = await world.create('backup').with({
      service: service.id,
      status: 'completed',
      objectKey: 'fixture.dmp',
      sizeBytes: 100
    })
    const owner = await withCsrfFromPage(request, '/', 'genesisUser')
    await sails.models.service
      .updateOne({ id: service.id })
      .set({ status: 'stopped' })
    const offline = await owner.request.get(
      `/projects/restore-tests/environments/production/dock/${service.id}?tab=backups`,
      { headers: { 'X-Inertia': 'true' } }
    )
    expect(offline).toHaveStatus(200)
    expect(offline.data.props.databaseService.status).toBe('stopped')
    await sails.models.service
      .updateOne({ id: service.id })
      .set({ status: 'running' })

    const original = sails.helpers.backup.runRestoreTest
    let entered, release
    const held = new Promise((resolve) => {
      release = resolve
    })
    const fake = async ({ testId }) => {
      entered = testId
      await held
      await sails.models.restoretest.updateOne({ id: testId }).set({
        status: 'completed',
        stage: 'completed',
        report: {
          checks: ['Database connectivity verified'],
          cleanup: 'removed'
        },
        completedAt: Date.now()
      })
    }
    fake.with = fake
    sails.helpers.backup.runRestoreTest = fake
    try {
      const first = await owner.request.post(
        `/api/v1/backups/${backup.id}/test-restore`,
        {}
      )
      expect(first).toHaveStatus(202)
      for (let i = 0; i < 100 && !entered; i++)
        await new Promise((resolve) => setTimeout(resolve, 10))
      const duplicate = await owner.request.post(
        `/api/v1/backups/${backup.id}/test-restore`,
        {}
      )
      expect(duplicate).toHaveStatus(202)
      expect(duplicate.data.test.id).toBe(first.data.test.id)
      expect(
        (await sails.models.service.findOne({ id: service.id })).status
      ).toBe('running')
      const history = await owner.request.get(
        `/api/v1/services/${service.id}/backups`
      )
      expect(history).toHaveStatus(200)
      expect(history.data.backups[0].restoreTest.id).toBe(first.data.test.id)
      expect(JSON.stringify(history.data).includes('resourceName')).toBe(false)
      expect(JSON.stringify(history.data).includes('storageCredentials')).toBe(
        false
      )
      release()
      for (
        let i = 0;
        i < 100 &&
        (await sails.models.restoretest.findOne({ id: first.data.test.id }))
          .status === 'running';
        i++
      )
        await new Promise((resolve) => setTimeout(resolve, 10))
      const project = current.projects.deploymentTarget
      const foreignTeam = await world
        .create('team')
        .with({ name: 'Other team', owner: current.users.genesisUser.id })
      await sails.models.project
        .updateOne({ id: project.id })
        .set({ team: foreignTeam.id })
      expect(
        await owner.request.get(`/api/v1/services/${service.id}/backups`)
      ).toHaveStatus(403)
      expect(
        await owner.request.post(
          `/api/v1/backups/${backup.id}/test-restore`,
          {}
        )
      ).toHaveStatus(403)
      await sails.models.project
        .updateOne({ id: project.id })
        .set({ team: current.teams.genesisTeam.id })
      for (let i = 0; i < 22; i++)
        await world.create('backup').with({
          service: service.id,
          status: 'completed',
          objectKey: `history-${i}.dmp`,
          sizeBytes: 100
        })
      const firstPage = await owner.request.get(
        `/api/v1/services/${service.id}/backups?selectedBackupId=${backup.id}`
      )
      expect(firstPage.data.hasMore).toBe(true)
      expect(firstPage.data.backups.length).toBe(21)
      expect(
        firstPage.data.backups.some(
          (b) => b.id === backup.id && b.restoreTest.id === first.data.test.id
        )
      ).toBe(true)
      const older = await owner.request.get(
        `/api/v1/services/${service.id}/backups?before=${firstPage.data.nextCursor}`
      )
      expect(older.data.hasMore).toBe(false)
      expect(older.data.backups.length).toBe(3)
      await sails.models.teammembership
        .update({
          user: current.users.genesisUser.id,
          team: current.teams.genesisTeam.id
        })
        .set({ role: 'member' })
      const otherOwner = await world.create('user').with({ fullName: 'Owner' })
      await sails.models.team
        .updateOne({ id: current.teams.genesisTeam.id })
        .set({ owner: otherOwner.id })
      const denied = await owner.request.post(
        `/api/v1/backups/${backup.id}/test-restore`,
        {}
      )
      expect(denied).toHaveStatus(403)
      const memberHistory = await owner.request.get(
        `/api/v1/services/${service.id}/backups`
      )
      expect(memberHistory).toHaveStatus(200)
      const pendingBackup = await world
        .create('backup')
        .with({ service: service.id, status: 'pending' })
      const cancelled = await sails.models.restoretest
        .create({
          backup: pendingBackup.id,
          service: service.id,
          team: current.teams.genesisTeam.id,
          resourceName:
            'slipway-restore-test-00000000-0000-0000-0000-000000000001'
        })
        .fetch()
      await sails.helpers.backup.manageRestoreTests.with({
        action: 'cancel',
        testId: cancelled.id,
        teamId: current.teams.genesisTeam.id
      })
      expect(
        (await sails.models.restoretest.findOne({ id: cancelled.id })).status
      ).toBe('cancelled')
      expect(
        (await sails.models.backup.findOne({ id: pendingBackup.id })).status
      ).toBe('failed')
      const interruptedBackup = await world
        .create('backup')
        .with({ service: service.id, status: 'running' })
      const interrupted = await sails.models.restoretest
        .create({
          backup: interruptedBackup.id,
          service: service.id,
          team: current.teams.genesisTeam.id,
          resourceName:
            'slipway-restore-test-00000000-0000-0000-0000-000000000002',
          status: 'running'
        })
        .fetch()
      const cleanup = sails.helpers.backup.cleanupRestoreTest
      sails.helpers.backup.cleanupRestoreTest = async () => {}
      try {
        await sails.helpers.backup.manageRestoreTests.with({
          action: 'recover'
        })
        expect(
          (await sails.models.restoretest.findOne({ id: interrupted.id }))
            .status
        ).toBe('interrupted')
        expect(
          (await sails.models.backup.findOne({ id: interruptedBackup.id }))
            .status
        ).toBe('failed')
        expect(
          (await sails.models.service.findOne({ id: service.id })).status
        ).toBe('running')
      } finally {
        sails.helpers.backup.cleanupRestoreTest = cleanup
      }
    } finally {
      release()
      await new Promise((resolve) => setTimeout(resolve, 100))
      sails.helpers.backup.runRestoreTest = original
    }
  }
)
