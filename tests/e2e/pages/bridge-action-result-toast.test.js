const { test } = require('sounding')
test(
  'detailed action toasts persist through ordinary notifications, scroll on mobile and close with keyboard',
  { browser: true, world: 'configured-slipway' },
  async ({ world, login, page, expect }) => {
    await page.raw.route('**/api/v1/system/check-update', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{"updateAvailable":false}'
      })
    )
    await login.withPassword('genesisUser', page, {
      password: world.current.auth.genesisUserPassword
    })
    await page.raw.waitForURL((url) => url.pathname !== '/login')
    await page.goto('/profile')
    const original = await page.raw.evaluate(
      () => window.history.state?.page || window.history.state
    )
    let flash
    await page.raw.route('**/profile', async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'X-Inertia': 'true' },
        body: JSON.stringify({
          ...original,
          props: { ...original.props, flash },
          url: '/profile'
        })
      })
    })
    const save = async (next, index) => {
      flash = next
      await page.raw.locator('#profile-full-name').fill('Organizer ' + index)
      await page.raw
        .getByRole('button', { name: 'Save changes', exact: true })
        .first()
        .click()
    }
    await save(
      {
        bridgeActionResult: {
          id: 'preview',
          title: 'Speaker email preview',
          type: 'info',
          counts: [{ label: 'recipients', value: 18 }],
          subject: 'Final checklist',
          items: [
            '<script>window.bad=true</script>',
            ...Array.from({ length: 17 }, (_, i) => `person-${i}@example.com`)
          ],
          message: 'Nothing sent.'
        }
      },
      0
    )
    const result = page.raw.locator('[data-test=bridge-action-result-toast]')
    await expect(result).toBeVisible()
    await page.raw.waitForTimeout(4500)
    await expect(result).toBeVisible()
    for (let i = 1; i <= 5; i++) {
      await save({ success: 'Ordinary notice ' + i }, i)
      await expect(
        page.raw.getByText('Ordinary notice ' + i, { exact: true })
      ).toBeVisible()
    }
    await expect(result).toHaveCount(1)
    await expect(result).toBeAttached()
    await page.raw.setViewportSize({ width: 390, height: 844 })
    const viewport = page.raw.locator('[data-slot=toast-viewport]')
    await viewport.hover()
    await expect(result).toBeVisible()
    const list = result.getByRole('list')
    await expect(list).toContainText('<script>window.bad=true</script>')
    expect(await page.raw.evaluate(() => window.bad)).toBe(undefined)
    expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(
      true
    )
    const close = result.getByRole('button', {
      name: 'Close Speaker email preview'
    })
    await close.focus()
    await page.raw.keyboard.press('Enter')
    await expect(result).toBeHidden()
    await page.raw.mouse.move(1, 1)
    await page.raw.locator('#profile-full-name').focus()
    await page.raw.waitForTimeout(4500)
    await expect(
      page.raw.getByText('Ordinary notice 5', { exact: true })
    ).toBeHidden()
    expect(page).toHaveNoSmoke()
  }
)
