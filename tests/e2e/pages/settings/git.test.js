const { test } = require('sounding')

test(
  'deploy token revocation reports denial and retains the confirmation for retry',
  { browser: true, world: 'configured-slipway' },
  async ({ sails, world, login, page, expect }) => {
    const token = await sails.models.deploytoken
      .create({
        name: 'Release automation',
        tokenPrefix: 'slp_fixture',
        tokenHash: 'fixture-hash',
        team: world.current.teams.genesisTeam.id,
        createdBy: world.current.users.genesisUser.id
      })
      .fetch()
    await login.withPassword('genesisUser', page, {
      password: world.current.auth.genesisUserPassword
    })
    await page.raw.waitForURL('**/')
    await page.goto('/settings/git')
    await page.raw.route(`**/api/v1/deploy-tokens/${token.id}`, (route) =>
      route.fulfill({ status: 403, json: { message: 'Denied' } })
    )
    await page.raw.getByRole('button', { name: 'Revoke', exact: true }).click()
    await page.raw
      .getByRole('button', { name: 'Revoke token', exact: true })
      .click()
    const toast = page.raw.locator(
      '[data-slot="toast"]:not([data-state="closing"])'
    )
    await expect(toast).toContainText('You no longer have permission')
    await expect(toast).not.toContainText('Deploy token revoked')
    await expect(page.raw.getByRole('dialog')).toBeVisible()
    expect(page).toHaveNoJavascriptErrors()
  }
)
