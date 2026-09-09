const { test } = require('sounding')
const fs = require('node:fs')
const path = require('node:path')

test(
  'Dock explains member permissions without hiding the database browser',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'dock-member' } }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current
    const database = await world.create('service').with({
      name: 'primary-db',
      type: 'postgresql',
      version: '17',
      status: 'running',
      environment: current.environments.production.id,
      database: 'app'
    })
    const owner = await world
      .create('user')
      .with({ fullName: 'Current team owner' })
    await sails.models.team
      .updateOne({ id: current.teams.genesisTeam.id })
      .set({ owner: owner.id })
    await sails.models.teammembership
      .update({
        user: current.users.genesisUser.id,
        team: current.teams.genesisTeam.id
      })
      .set({ role: 'member' })
    await page.raw.route('**/dock/tables?**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ tables: [{ name: 'users', rowCount: 2 }] })
      })
    )
    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await page.raw.waitForURL('**/')
    await page.goto(
      `/projects/dock-member/environments/production/dock/${database.id}`
    )
    const root = path.resolve('output/issue-372-permissions')
    fs.mkdirSync(root, { recursive: true })
    for (const [width, scheme] of [
      [1280, 'light'],
      [390, 'dark']
    ]) {
      await page.raw.setViewportSize({ width, height: 900 })
      await page.raw.emulateMedia({ colorScheme: scheme })
      const notice = page.raw
        .locator('[data-slot="alert"]')
        .filter({ hasText: 'Team members can browse' })
      await expect(notice).toBeVisible()
      await expect(
        page.raw.getByRole('tab', { name: 'SQL', exact: true })
      ).toBeVisible()
      await page.raw.getByRole('tab', { name: 'SQL', exact: true }).click()
      await expect(
        page.raw.getByRole('button', { name: 'Run', exact: true })
      ).toBeDisabled()
      await page.raw.getByRole('tab', { name: /^tables$/i }).click()
      expect(
        await page.raw
          .getByRole('button', { name: 'Apply', exact: true })
          .count()
      ).toBe(0)
      expect(
        await page.raw
          .getByRole('button', { name: 'Import database', exact: true })
          .count()
      ).toBe(0)
      await expect(
        page.raw.getByRole('status').filter({ hasText: 'Loading tables' })
      ).toHaveCount(0)
      await page.screenshot(path.join(root, `member-${width}.png`), {
        animations: 'disabled'
      })
    }
  }
)
