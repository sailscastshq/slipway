const { test } = require('sounding')
const fs = require('node:fs/promises')
const path = require('node:path')
test(
  'external database creation stays simple and exposes verification instead of container controls',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'external-pg-ui' } }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    await login.withPassword('genesisUser', page, {
      password: world.current.auth.genesisUserPassword
    })
    await page.raw.waitForURL('**/')
    await page.goto('/projects/external-pg-ui/environments/production?services')
    await page.raw
      .getByRole('button', { name: '+ Add service', exact: true })
      .click()
    await page.raw.getByRole('combobox', { name: 'Service type' }).click()
    await page.raw
      .getByRole('option', { name: 'External PostgreSQL', exact: true })
      .click()
    await page.raw.getByPlaceholder('Service name').fill('customer-database')
    const fields = page.raw.locator('[data-test="external-postgresql-fields"]')
    await fields
      .locator('#external-postgres-dsn')
      .fill(
        'postgresql://backup:private-fixture-secret@database.example.com/customers'
      )
    await expect(
      page.raw.getByRole('combobox', { name: 'Service version' })
    ).toHaveCount(0)
    await expect(
      page.raw.getByRole('textbox', { name: 'Custom service version' })
    ).toHaveCount(0)
    const output = path.resolve('output/issue-378')
    await fs.mkdir(output, { recursive: true })
    for (const [width, colorScheme] of [
      [1280, 'light'],
      [390, 'dark']
    ]) {
      await page.raw.setViewportSize({ width, height: 1000 })
      await page.raw.emulateMedia({ colorScheme })
      await fields.scrollIntoViewIfNeeded()
      expect(
        await fields
          .locator('#external-postgres-dsn')
          .evaluate((el) => getComputedStyle(el).borderBottomStyle)
      ).toBe('dashed')
      expect(
        await page.raw.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true)
      await page.screenshot(
        path.join(output, `external-postgresql-${width}.png`),
        { animations: 'disabled' }
      )
    }
    await page.raw.getByRole('button', { name: 'Connect', exact: true }).click()
    await page.raw
      .getByRole('link', { name: 'customer-database', exact: true })
      .click()
    const panel = page.raw.locator('[data-test="external-database-status"]')
    await expect(panel.getByRole('button')).toHaveCount(2)
    await expect(panel).toContainText('Verify the connection')
    await expect(
      page.raw.getByRole('heading', { name: 'Logs', exact: true })
    ).toHaveCount(0)
    const service = await sails.models.service.findOne({
      name: 'customer-database'
    })
    await page.raw.route(
      `**/api/v1/services/${service.id}/verify-external`,
      async (route) => {
        await sails.models.service
          .updateOne({ id: service.id })
          .set({ status: 'unreachable' })
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            verification: {
              status: 'unreachable',
              message:
                'TLS verification failed. Check the database certificate, hostname and CA.'
            }
          })
        })
      }
    )
    await panel
      .getByRole('button', { name: 'Verify connection', exact: true })
      .click()
    await expect(panel.getByRole('alert')).toHaveAttribute('data-slot', 'alert')
    await expect(
      page.raw.getByText('Unreachable', { exact: true })
    ).toBeVisible()
    expect(
      await page.raw.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true)
    const badge = await page.raw
      .getByText('Unreachable', { exact: true })
      .boundingBox()
    expect(badge.x + badge.width <= 390).toBe(true)
    await page.screenshot(
      path.join(output, 'external-postgresql-tls-390.png'),
      { animations: 'disabled' }
    )
    await panel
      .getByRole('button', { name: 'Edit connection', exact: true })
      .click()
    await expect(panel.locator('#external-postgres-dsn')).toHaveValue('')
    await page.goto('/projects/external-pg-ui/environments/production?services')
    await page.raw
      .getByRole('button', {
        name: 'Actions for customer-database',
        exact: true
      })
      .click()
    await page.raw
      .getByRole('menuitem', { name: 'Delete', exact: true })
      .click()
    await expect(
      page.raw.getByText(
        'The connection and its managed environment variables will be removed. The provider database is unchanged, and backups are retained by default.'
      )
    ).toBeVisible()
    await expect(
      page.raw.getByRole('button', { name: 'Remove connection', exact: true })
    ).toBeVisible()
    await page.raw.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect(page).toHaveNoJavascriptErrors()
  }
)
