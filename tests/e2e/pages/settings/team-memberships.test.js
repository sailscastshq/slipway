const { test } = require('sounding')
const fs = require('node:fs')
test(
  'team switcher shows retained memberships and invitations',
  { browser: true, world: 'configured-slipway' },
  async ({ sails, world, login, page, expect }) => {
    const user = world.current.users.genesisUser
    const team = await sails.models.team
      .create({ name: 'Studio workspace', owner: user.id })
      .fetch()
    await sails.models.teammembership
      .updateOne({ user: user.id, team: team.id })
      .set({ status: 'invited', role: 'member' })
    await login.withPassword('genesisUser', page, {
      password: world.current.auth.genesisUserPassword
    })
    await page.goto('/settings/team')
    await page.raw.locator('[data-test="desktop-team-selector"]').click()
    await page.raw
      .locator('#desktop-team-menu')
      .getByText('Join Studio workspace', { exact: true })
      .waitFor()
    fs.mkdirSync('.github/screenshots/audit-team-memberships', {
      recursive: true
    })
    await page.screenshot(
      '.github/screenshots/audit-team-memberships/switcher.png',
      { fullPage: true, animations: 'disabled' }
    )
    await page.raw
      .locator('#desktop-team-menu')
      .getByText('Join Studio workspace', { exact: true })
      .click()
    await page.raw.waitForURL('**/')
    expect(
      (
        await sails.models.teammembership.findOne({
          user: user.id,
          team: team.id
        })
      ).status
    ).toBe('active')
    await page.goto('/settings/team')
    await expect(page).toSee('Studio workspace')
  }
)
