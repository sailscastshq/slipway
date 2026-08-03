const { test } = require('sounding')

const world = {
  name: 'configured-slipway',
  context: {
    deploymentTarget: {
      slug: 'configuration-secrets-ui',
      name: 'Configuration Secrets UI'
    }
  }
}

async function navigateAfterUpdateCheck(page, target) {
  const updateCheckFinished = page.raw.waitForResponse(
    '**/api/v1/system/check-update'
  )
  await page.goto(target)
  await updateCheckFinished
}

async function screenshotConfig(page, selector, path) {
  const section = page.raw.locator(`[data-test="${selector}"]`)
  await section.evaluate((element) =>
    element.scrollIntoView({ block: 'center', inline: 'nearest' })
  )
  await page.wait(100)
  await page.screenshot(path)
}

test(
  'configuration metadata stays minimal and legible in light and dark mode',
  { browser: true, world },
  async ({ sails, world: currentWorld, login, page, expect }) => {
    const current = currentWorld.current
    const changedAt = Date.now() - 5 * 60 * 1000
    const changedBy = String(current.users.genesisUser.id)
    const changedByName = current.users.genesisUser.fullName

    await sails.models.environment
      .updateOne({ id: current.environments.production.id })
      .set({
        envVars: {
          DATABASE_URL: 'postgresql://managed',
          LEGACY_SECRET: 'legacy-environment-secret',
          RELEASE_CHANNEL: 'stable'
        },
        envVarMetadata: {
          DATABASE_URL: {
            kind: 'secret',
            managed: true,
            previewPolicy: 'omit',
            description: 'Connection URL managed by main-db',
            changedAt,
            changedBy,
            changedByName
          },
          RELEASE_CHANNEL: {
            kind: 'plain',
            managed: false,
            previewPolicy: 'inherit',
            changedAt,
            changedBy,
            changedByName
          }
        }
      })
    await currentWorld.create('service').with({
      name: 'main-db',
      environment: current.environments.production.id,
      envVarKey: 'DATABASE_URL',
      status: 'stopped'
    })
    await sails.models.app.updateOne({ id: current.apps.web.id }).set({
      secureEnvVars: {
        APP_SIGNING_SECRET: 'app-secret',
        LEGACY_APP_SECRET: 'legacy-app-secret'
      },
      envVars: {},
      envVarMetadata: {
        APP_SIGNING_SECRET: {
          kind: 'secret',
          managed: false,
          previewPolicy: 'randomize',
          description: 'Signs application sessions',
          changedAt,
          changedBy,
          changedByName
        }
      }
    })
    await sails.helpers.setting.set(
      'globalEnvVars',
      JSON.stringify({
        GLOBAL_REGION: 'eu-central',
        LEGACY_GLOBAL_SECRET: 'legacy-global-secret'
      })
    )
    await sails.helpers.setting.set(
      'globalEnvVarMetadata',
      JSON.stringify({
        GLOBAL_REGION: {
          kind: 'plain',
          managed: false,
          previewPolicy: 'inherit',
          changedAt,
          changedBy,
          changedByName
        }
      })
    )
    const deployment = await currentWorld.create('deployment').with({
      environment: current.environments.production.id,
      app: current.apps.web.id,
      status: 'running',
      startedAt: Date.now() - 10000,
      finishedAt: Date.now(),
      configHash:
        '01ac25cead174bfd49274d3ce5f84fc880118092f44470a4ad6e1204b7c2d75',
      configManifest: [
        { key: 'GLOBAL_REGION', scope: 'global', kind: 'plain' },
        { key: 'DATABASE_URL', scope: 'environment', kind: 'secret' },
        { key: 'APP_SIGNING_SECRET', scope: 'app', kind: 'secret' }
      ]
    })

    await page.raw.route('**/api/v1/system/check-update', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ updateAvailable: false })
      })
    })
    await page.resize(1440, 1000)
    await page.inLightMode()
    const loginUpdateCheckFinished = page.raw.waitForResponse(
      '**/api/v1/system/check-update'
    )
    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await loginUpdateCheckFinished

    await navigateAfterUpdateCheck(
      page,
      '/projects/configuration-secrets-ui/environments/production?env=1'
    )
    await page.wait('@environment-config')
    const legacyEnvironmentSummary = page.raw.locator(
      '[data-test="config-variable-summary-LEGACY_SECRET"]'
    )
    expect((await legacyEnvironmentSummary.textContent()).trim()).toBe('Secret')
    const managedEnvironmentSummary = page.raw.locator(
      '[data-test="config-variable-summary-DATABASE_URL"]'
    )
    expect(
      (await managedEnvironmentSummary.textContent()).includes('ago')
    ).toBe(true)
    const managedMenu = page.raw.locator(
      '[data-test="config-menu-DATABASE_URL"] summary'
    )
    await managedMenu.focus()
    await managedMenu.press('Enter')
    expect(
      await managedMenu.evaluate((summary) => summary.parentElement.open)
    ).toBe(true)
    await expect(page).toSee(
      'Managed by Slipway. Change or remove the service that owns this value.'
    )
    await expect(page).toSee('Not copied to preview environments.')
    await screenshotConfig(
      page,
      'environment-config',
      '.tmp/issue-200-environment-secrets-light.png'
    )
    await page.resize(390, 844)
    await screenshotConfig(
      page,
      'environment-config',
      '.tmp/issue-357-environment-secrets-narrow.png'
    )

    await page.inDarkMode()
    await page.resize(1440, 1000)
    await navigateAfterUpdateCheck(
      page,
      '/projects/configuration-secrets-ui/environments/production/apps/web?env=1'
    )
    await page.wait('@app-config')
    const legacyAppSummary = page.raw.locator(
      '[data-test="config-variable-summary-LEGACY_APP_SECRET"]'
    )
    expect((await legacyAppSummary.textContent()).trim()).toBe('Secret')
    await page.raw.locator('input[value="APP_SIGNING_SECRET"]').hover()
    await page.raw
      .locator('[data-test="config-menu-APP_SIGNING_SECRET"] summary')
      .click()
    await expect(page).toSee('Generate a new value')
    await expect(page).toSee(
      'A fresh value is generated for each preview environment.'
    )
    await screenshotConfig(
      page,
      'app-config',
      '.tmp/issue-200-app-secrets-dark.png'
    )

    await page.inLightMode()
    await navigateAfterUpdateCheck(page, '/settings/global-env')
    await page.wait('@global-config')
    const legacyGlobalSummary = page.raw.locator(
      '[data-test="config-variable-summary-LEGACY_GLOBAL_SECRET"]'
    )
    expect((await legacyGlobalSummary.textContent()).trim()).toBe('Secret')
    await page.raw
      .locator('[data-test="config-menu-GLOBAL_REGION"] summary')
      .click()
    await expect(page).toSee('Copied to preview environments.')
    await screenshotConfig(
      page,
      'global-config',
      '.tmp/issue-200-global-config-light.png'
    )

    await page.inDarkMode()
    await navigateAfterUpdateCheck(
      page,
      `/projects/configuration-secrets-ui/deployments/${deployment.id}`
    )
    await page.wait('@config-fingerprint')
    await page.screenshot('.tmp/issue-200-deployment-config-dark.png')
    await expect(page).toSee('01ac25cead17')
    await expect(page).toSee('3 vars')
    expect(page).toHaveNoSmoke()
  }
)
