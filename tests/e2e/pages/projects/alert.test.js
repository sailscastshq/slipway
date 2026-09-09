const fs = require('node:fs')
const path = require('node:path')
const { test } = require('sounding')

const capturePhase = process.env.ALERT_SCREENSHOT_PHASE || 'after'
const captureFollowupOnly = process.env.ALERT_FOLLOWUP_ONLY === '1'
const screenshotRoot = path.resolve(
  `.tmp/screenshots/issue-441-alert/${capturePhase}`
)

test(
  'deployment notices preserve their visual and semantic contracts with Klean Alert',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'alert-visual-contract',
          name: 'Alert visual contract',
          failure:
            'The container started, but the health check could not reach /health after 30 seconds. Review the configured health path and confirm the application listens on the assigned port before deploying again.'
        }
      }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    fs.mkdirSync(screenshotRoot, { recursive: true })

    const current = world.current
    const project = current.projects.deploymentTarget
    const environment = current.environments.production
    const app = current.apps.web
    const deployment = current.deployments.failed
    const environmentPath = `/projects/${project.slug}/environments/${environment.slug}?apps=1`

    await sails.models.app.updateOne({ id: app.id }).set({
      status: 'stopped',
      containerId: null,
      containerName: null
    })

    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })

    if (captureFollowupOnly) {
      await page.raw.setViewportSize({ width: 1440, height: 1000 })
      await page.raw.emulateMedia({ colorScheme: 'light' })
      await page.goto(
        `/projects/${project.slug}/environments/${environment.slug}/helm?appSlug=${app.slug}`
      )
      const helmNotice = page.raw.locator(
        '[data-test="helm-not-running-notice"]'
      )
      await expect(helmNotice).toBeVisible()
      await helmNotice.screenshot({
        path: path.join(screenshotRoot, 'helm-not-running-light.png')
      })
      expect(page).toHaveNoJavascriptErrors()
      return
    }

    await page.goto(environmentPath)

    const checklist = page.raw.locator('[data-test="deployment-checklist"]')
    await expect(checklist).toHaveCount(0)
    await page.raw.setViewportSize({ width: 1440, height: 1000 })
    await page.raw.emulateMedia({ colorScheme: 'light' })

    const appActions = page.raw.locator(`[data-test="app-actions-${app.slug}"]`)
    await appActions.focus()
    await appActions.press('Enter')

    const sourceRequired = page.raw.locator(
      '[data-test="deployment-source-required"]'
    )
    await expect(sourceRequired).toBeVisible()
    await expect(sourceRequired).toContainText('Deployment source required')
    await expect(
      sourceRequired.getByRole('link', { name: 'Repository settings' })
    ).toHaveAttribute(
      'href',
      `/projects/${project.slug}/environments/${environment.slug}/apps/${app.slug}/settings`
    )
    await page.raw
      .locator(`[data-test="app-action-menu-${app.slug}"]`)
      .screenshot({
        path: path.join(screenshotRoot, 'source-required-menu-light.png')
      })

    if (capturePhase === 'after') {
      await expect(checklist).toHaveCount(0)
      expect(await sourceRequired.getAttribute('data-slot')).toBe('alert')
      expect(await sourceRequired.getAttribute('role')).toBe('note')
    }

    await page.goto(`/projects/${project.slug}/deployments/${deployment.id}`)
    const failureSummary = page.raw.locator(
      '[data-test="deployment-failure-summary"]'
    )
    await expect(failureSummary).toBeVisible()
    await expect(failureSummary).toContainText('Deployment failed')
    await expect(failureSummary).toContainText(
      'The container started, but the health check could not reach /health'
    )
    await failureSummary.screenshot({
      path: path.join(screenshotRoot, 'failure-summary-light.png')
    })

    if (capturePhase === 'after') {
      expect(await failureSummary.getAttribute('data-slot')).toBe('alert')
      expect(await failureSummary.getAttribute('role')).toBe(null)
      expect(await failureSummary.evaluate((element) => element.tagName)).toBe(
        'SECTION'
      )
    }

    await page.goto(
      `/projects/${project.slug}/environments/${environment.slug}/helm?appSlug=${app.slug}`
    )
    const helmNotice = page.raw.locator('[data-test="helm-not-running-notice"]')
    await expect(helmNotice).toBeVisible()
    await expect(helmNotice).toContainText(
      'App not running. Deploy first to use Helm.'
    )
    await helmNotice.screenshot({
      path: path.join(screenshotRoot, 'helm-not-running-light.png')
    })

    if (capturePhase === 'after') {
      expect(await helmNotice.getAttribute('data-slot')).toBe('alert')
      expect(await helmNotice.getAttribute('role')).toBe('note')
    }

    expect(page).toHaveNoJavascriptErrors()
  }
)
