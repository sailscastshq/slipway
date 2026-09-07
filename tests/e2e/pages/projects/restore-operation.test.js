const { test } = require('sounding')
const fs = require('node:fs')
test(
  'service page exposes interrupted restore recovery and safety snapshot',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'restore-ui' } }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current
    const service = await world.create('service').with({
      environment: current.environments.production.id,
      name: 'main-db',
      status: 'failed',
      containerName: 'restore-ui-db',
      internalHost: 'restore-ui-db',
      internalPort: 5432,
      database: 'app',
      username: 'postgres'
    })
    const backup = await world
      .create('backup')
      .with({ service: service.id, status: 'completed', s3Key: 'fixture.dmp' })
    await sails.models.restoreoperation.create({
      backup: backup.id,
      service: service.id,
      team: current.teams.genesisTeam.id,
      status: 'interrupted',
      stage: 'import',
      snapshotId: backup.id,
      error:
        'Server stopped during restoration. Keep writes paused and inspect the safety snapshot before recovery.'
    })
    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await page.goto(
      `/projects/restore-ui/environments/production/services/${service.id}`
    )
    await page.raw
      .getByRole('heading', { name: 'Database restoration' })
      .waitFor()
    await expect(page).toSee('interrupted')
    await expect(page.raw.getByRole('alert')).toHaveAttribute(
      'data-slot',
      'alert'
    )
    await expect(page).toSee(`Safety snapshot: ${backup.id}`)
    expect(
      await page.raw
        .getByRole('button', { name: 'Restore backup', exact: true })
        .isDisabled()
    ).toBe(true)
    fs.mkdirSync('.github/screenshots/audit-restore-operation', {
      recursive: true
    })
    await page.screenshot(
      '.github/screenshots/audit-restore-operation/recovery.png',
      { fullPage: true, animations: 'disabled' }
    )
  }
)
