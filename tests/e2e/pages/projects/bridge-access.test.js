const { test } = require('sounding')
const fs = require('node:fs')
const path = require('node:path')

test(
  'one Bridge entry opens setup without starting a worker and retains operator workspace access',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'bridge-app-menu',
          name: 'Bridge App Menu'
        }
      }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current
    const app = current.apps.web
    const environment = current.environments.production
    const project = current.projects.deploymentTarget
    const originalGetContainerStatus = sails.helpers.docker.getContainerStatus
    const originalIntrospect = sails.helpers.bridge.introspectModels
    let inspections = 0
    sails.helpers.bridge.introspectModels = async () => {
      inspections += 1
      return { models: {}, dashboards: {} }
    }
    const output = path.resolve('.tmp/local-review/bridge-742')
    fs.mkdirSync(output, { recursive: true })

    try {
      await sails.models.app.updateOne({ id: app.id }).set({
        bridgeEnabled: false,
        status: 'running',
        containerName: 'bridge-app-menu-web'
      })
      sails.helpers.docker.getContainerStatus = async () => ({
        running: true,
        health: 'healthy'
      })

      await login.withPassword('genesisUser', page, {
        password: current.auth.genesisUserPassword
      })
      await page.raw.waitForURL('**/')
      const appPath = `/projects/${project.slug}/environments/${environment.slug}/apps/${app.slug}`
      await page.raw.route('**/api/v1/system/check-update', (route) =>
        route.fulfill({ json: { updateAvailable: false } })
      )
      await page.goto(appPath)
      await page.click('@app-more-menu')

      const bridgeLink = page.raw.getByRole('menuitem', {
        name: 'Bridge',
        exact: true
      })
      await bridgeLink.waitFor({ state: 'visible' })
      expect(await bridgeLink.count()).toBe(1)
      expect(await bridgeLink.getAttribute('href')).toBe(
        `${appPath}/bridge/access`
      )
      expect(
        await page.raw
          .getByRole('menuitem', { name: 'Open Bridge', exact: true })
          .count()
      ).toBe(0)
      await page.screenshot(path.join(output, 'menu.png'), {
        animations: 'disabled'
      })
      await expect(page).not.toSee('Bridge in Slipway')
      await expect(page).not.toSee('Public Bridge')
      await bridgeLink.click()
      await expect(
        page.raw.getByRole('heading', { name: 'Bridge', exact: true })
      ).toBeVisible()
      expect(await page.raw.title()).toBe(`Bridge - ${app.name} | Slipway`)
      await expect(
        page.raw.getByRole('heading', { name: 'App-local access is off' })
      ).toBeVisible()
      expect(inspections).toBe(0)
      await page.screenshot(path.join(output, 'access-off.png'), {
        fullPage: true,
        animations: 'disabled'
      })
      await page.raw
        .getByRole('link', { name: 'Open workspace', exact: true })
        .click()
      await expect(
        page.raw.getByText('No resources available', { exact: true })
      ).toBeVisible()
      expect(inspections).toBe(1)
      await page.raw
        .getByRole('link', { name: 'Manage access', exact: true })
        .click()
      await page.raw
        .getByRole('button', { name: 'Enable Bridge', exact: true })
        .click()
      await expect(
        page.raw.locator('[data-test="bridge-hook-warning"]')
      ).toBeVisible()
      expect(
        (await sails.models.app.findOne({ id: app.id })).bridgeEnabled
      ).toBe(true)
      expect(inspections).toBe(1)
      await page.screenshot(path.join(output, 'access-on.png'), {
        fullPage: true,
        animations: 'disabled'
      })
      expect(page).toHaveNoJavascriptErrors()
    } finally {
      sails.helpers.docker.getContainerStatus = originalGetContainerStatus
      sails.helpers.bridge.introspectModels = originalIntrospect
    }
  }
)

for (const kind of ['configuration', 'killed']) {
  test(
    `Bridge ${kind} failure offers the relevant recovery path`,
    {
      browser: true,
      world: {
        name: 'configured-slipway',
        context: { deploymentTarget: { slug: `bridge-${kind}-742` } }
      }
    },
    async ({ sails, world, login, page, expect }) => {
      const current = world.current
      const app = current.apps.web
      const original = sails.helpers.bridge.introspectModels
      let failing = true
      sails.helpers.bridge.introspectModels = async () =>
        failing
          ? {
              models: {},
              error:
                kind === 'configuration'
                  ? 'Bridge resource "sponsorbooth".create must be an array of field names or false to disable the action.'
                  : 'Bridge worker stopped unexpectedly (exit 137).',
              errorCode:
                kind === 'configuration'
                  ? 'BRIDGE_INVALID_CONFIG'
                  : 'BRIDGE_WORKER_KILLED'
            }
          : { models: {}, dashboards: {} }
      try {
        await sails.models.app
          .updateOne({ id: app.id })
          .set({ status: 'running', containerName: `bridge-${kind}-742` })
        await page.raw.route('**/api/v1/system/check-update', (route) =>
          route.fulfill({ json: { updateAvailable: false } })
        )
        await login.withPassword('genesisUser', page, {
          password: current.auth.genesisUserPassword
        })
        await page.raw.waitForURL('**/')
        const appPath = `/projects/${current.projects.deploymentTarget.slug}/environments/${current.environments.production.slug}/apps/${app.slug}`
        await page.goto(`${appPath}/bridge`)
        const region = page.raw.locator('[data-test="bridge-models-error"]')
        await expect(region.getByRole('heading')).toHaveText(
          kind === 'configuration'
            ? 'Bridge configuration needs attention'
            : 'Bridge worker was stopped'
        )
        await expect(
          region.getByRole('link', { name: 'View app logs' })
        ).toHaveAttribute('href', `${appPath}?logs=1`)
        await expect(
          region.getByRole('link', { name: 'App settings' })
        ).toHaveAttribute('href', `${appPath}/settings`)
        await region.getByText('Error details', { exact: true }).click()
        const output = path.resolve('.tmp/local-review/bridge-742')
        fs.mkdirSync(output, { recursive: true })
        await page.screenshot(path.join(output, `${kind}.png`), {
          fullPage: true,
          animations: 'disabled'
        })
        if (kind === 'configuration') {
          await expect(region).toContainText('then redeploy')
          expect(
            await region
              .getByRole('button', { name: 'Retry', exact: true })
              .count()
          ).toBe(0)
        } else {
          await expect(region).toContainText('memory limit or an external kill')
          failing = false
          await region
            .getByRole('button', { name: 'Retry', exact: true })
            .click()
          await expect(
            page.raw.getByText('No resources available', { exact: true })
          ).toBeVisible()
        }
        expect(page).toHaveNoJavascriptErrors()
      } finally {
        sails.helpers.bridge.introspectModels = original
      }
    }
  )
}
