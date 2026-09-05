const { test } = require('sounding')

test(
  'browser login replaces its session cookie and explains credential changes',
  { browser: true, world: 'configured-slipway' },
  async ({ world, page, expect }) => {
    await page.goto('/login')
    const cookie = async () =>
      (await page.raw.context().cookies()).find(
        (item) => item.name === 'slipway.sid.v2'
      )?.value
    const before = await cookie()
    expect(Boolean(before)).toBe(true)
    await page.fill('#email', world.current.users.genesisUser.email)
    await page.fill('#password', world.current.auth.genesisUserPassword)
    await page.raw.locator('button[type="submit"]').click()
    await page.wait('text=Get started by creating your first project')
    const after = await cookie()
    expect(Boolean(after)).toBe(true)
    expect(after === before).toBe(false)
    await page.goto('/profile')
    await expect(page).toSee(
      'Changing your password signs out other sessions and revokes CLI tokens.'
    )
    await page.screenshot('.tmp/audit-authentication-recovery-profile.png', {
      fullPage: true
    })
    expect(page).toHaveNoJavascriptErrors()
  }
)
