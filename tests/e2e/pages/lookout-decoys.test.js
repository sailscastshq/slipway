const { test } = require('sounding')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

test(
  'Lookout Decoys settings and grouped observations stay usable in light, dark, desktop and mobile',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'decoy-ui', name: 'Observatory' } }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const app = world.current.apps.web,
      env = world.current.environments.production
    const base = `/projects/decoy-ui/environments/${env.slug}`
    const output = path.resolve('.tmp/screenshots/797')
    await fs.mkdir(output, { recursive: true })
    await page.raw.route('**/api/v1/system/check-update', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{}'
      })
    )
    await login.withPassword('genesisUser', page, {
      password: world.current.auth.genesisUserPassword
    })
    await page.raw.waitForURL('**/')
    await page.goto(`${base}/apps/${app.slug}/settings`)
    const section = page.raw.getByTestId('decoy-settings')
    await expect(section.getByRole('switch')).not.toBeChecked()
    await expect(section).toContainText('Off · no paths intercepted')
    await page.raw.setViewportSize({ width: 1440, height: 1000 })
    await section.scrollIntoViewIfNeeded()
    await page.screenshot(
      path.join(output, 'settings-before-light-desktop.png'),
      { animations: 'disabled' }
    )
    const toggle = section.getByRole('switch')
    await toggle.focus()
    await toggle.press('Space')
    await expect(toggle).toBeChecked()
    const envPath = section.getByRole('checkbox', {
      name: '/.env',
      exact: true
    })
    await envPath.focus()
    await envPath.press('Space')
    await expect(envPath).toBeChecked()
    const save = section.getByRole('button', { name: 'Save decoy settings' })
    await expect(save).toBeDisabled()
    const acknowledgement = section.getByRole('checkbox', {
      name: 'I verified that the selected paths are unused.'
    })
    await acknowledgement.focus()
    await acknowledgement.press('Space')
    await expect(save).toBeEnabled()
    await save.focus()
    await save.press('Enter')
    await expect(section).toContainText(
      'Configured · applies on first deployment'
    )
    for (const width of [1440, 390])
      for (const scheme of ['light', 'dark']) {
        await page.raw.setViewportSize({ width, height: 1000 })
        await (scheme === 'dark' ? page.inDarkMode() : page.inLightMode())
        await section.scrollIntoViewIfNeeded()
        assert.ok(
          await page.raw.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          )
        )
        await page.screenshot(
          path.join(output, `settings-${scheme}-${width}.png`),
          { animations: 'disabled' }
        )
      }
    await sails.models.telemetrymetric.createEach([
      {
        environment: String(env.id),
        name: 'lookout.decoy_hit',
        value: 1,
        unit: 'count',
        recordedAt: Date.now(),
        attributes: {
          kind: 'decoy_hit',
          appId: String(app.id),
          path: '/.env',
          method: 'GET',
          statusCode: 200
        }
      },
      {
        environment: String(env.id),
        name: 'lookout.decoy_hit',
        value: 1,
        unit: 'count',
        recordedAt: Date.now() - 1000,
        attributes: {
          kind: 'decoy_hit',
          appId: String(app.id),
          path: '/.env',
          method: 'GET',
          statusCode: 200
        }
      },
      {
        environment: String(env.id),
        name: 'lookout.decoy_hit',
        value: 1,
        unit: 'count',
        recordedAt: Date.now(),
        attributes: {
          kind: 'decoy_hit',
          appId: String(app.id),
          path: '/wp-config.php',
          method: 'HEAD',
          statusCode: 503
        }
      }
    ])
    await sails.models.telemetryspan.create({
      traceId: 'lookout-style-fixture',
      spanId: 'lookout-style-span',
      name: 'GET /normal',
      kind: 'server',
      method: 'GET',
      url: '/normal',
      statusCode: 200,
      duration: 12,
      startedAt: Date.now(),
      environment: String(env.id)
    })
    await page.raw.setViewportSize({ width: 1440, height: 1000 })
    await page.goto(`${base}/lookout?tab=decoys`)
    const hits = page.raw.getByRole('region', { name: 'Decoy hits' })
    await expect(hits.getByRole('row')).toHaveCount(3)
    await expect(hits).toContainText('HEAD · 503')
    await hits.getByLabel('Path', { exact: true }).selectOption('/.env')
    await expect(hits.getByRole('row')).toHaveCount(2)
    await page.raw.reload()
    await expect(hits.getByLabel('Path', { exact: true })).toHaveValue('/.env')
    await hits.getByLabel('Path', { exact: true }).selectOption('')
    for (const width of [1440, 390])
      for (const scheme of ['light', 'dark']) {
        await page.raw.setViewportSize({ width, height: 1000 })
        await (scheme === 'dark' ? page.inDarkMode() : page.inLightMode())
        await hits.scrollIntoViewIfNeeded()
        for (const label of ['App', 'Path']) {
          const filter = hits.getByLabel(label, { exact: true })
          const styles = await filter.evaluate((el) => {
            const s = getComputedStyle(el)
            return {
              bottom: s.borderBottomStyle,
              top: s.borderTopWidth,
              radius: s.borderRadius,
              background: s.backgroundColor
            }
          })
          assert.equal(styles.bottom, 'dashed')
          assert.equal(styles.top, '0px')
          assert.equal(styles.radius, '0px')
          assert.equal(styles.background, 'rgba(0, 0, 0, 0)')
          await filter.focus()
          await expect(filter).toBeFocused()
        }

        assert.ok(
          await page.raw.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          )
        )
        await page.screenshot(
          path.join(output, `hits-${scheme}-${width}.png`),
          { animations: 'disabled' }
        )
      }
    await sails.models.environment
      .updateOne({ id: env.id })
      .set({ features: { 'sails-hook-slipway': { version: '0.0.100' } } })
    await page.raw.setViewportSize({ width: 1440, height: 1000 })
    await page.goto(`${base}/lookout?tab=requests`)
    const status = page.raw.getByLabel('Request status', { exact: true })
    await expect(status).toBeVisible()
    await status.focus()
    await status.press('ArrowDown')
    await page.raw.getByRole('option', { name: '5xx', exact: true }).click()
    await expect(
      page.raw.getByText('No requests match your filters.')
    ).toBeVisible()
    for (const width of [1440, 390])
      for (const scheme of ['light', 'dark']) {
        await page.raw.setViewportSize({ width, height: 1000 })
        await (scheme === 'dark' ? page.inDarkMode() : page.inLightMode())
        await status.scrollIntoViewIfNeeded()
        const style = await status.evaluate((el) => {
          const s = getComputedStyle(el)
          return {
            bottom: s.borderBottomStyle,
            top: s.borderTopWidth,
            radius: s.borderRadius,
            background: s.backgroundColor
          }
        })
        assert.equal(style.bottom, 'dashed')
        assert.equal(style.top, '0px')
        assert.equal(style.radius, '0px')
        assert.equal(style.background, 'rgba(0, 0, 0, 0)')
        await status.focus()
        await expect(status).toBeFocused()
        await page.screenshot(
          path.join(output, `request-status-${scheme}-${width}.png`),
          { animations: 'disabled' }
        )
      }
  }
)
