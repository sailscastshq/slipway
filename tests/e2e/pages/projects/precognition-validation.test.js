const { test } = require('sounding')

test(
  'project and app configuration validates inline before submission',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'browser-precognition',
          name: 'Browser Precognition'
        }
      }
    }
  },
  async ({ world, login, page, expect }) => {
    const current = world.current

    await page.resize(1440, 900)
    await page.raw.emulateMedia({ colorScheme: 'light' })
    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })

    await page.goto('/projects/new')
    await page.fill('#name', '---')
    await page.raw.locator('#name').blur()
    await page.raw.locator('#project-name-error').waitFor({ state: 'visible' })
    await expect(page).toSee('Name must include at least one letter or number')
    await page.screenshot('.tmp/issue-206-project-validation-light.png', {
      fullPage: true
    })

    const project = current.projects.deploymentTarget
    const environment = current.environments.production
    const app = current.apps.web
    await page.raw.emulateMedia({ colorScheme: 'dark' })
    await page.goto(
      `/projects/${project.slug}/environments/${environment.slug}/apps/${app.slug}/settings`
    )
    await page.fill('#cpuLimit', '0')
    await page.raw.locator('#cpuLimit').blur()
    await page.raw.locator('#cpu-limit-error').waitFor({ state: 'visible' })
    await expect(page).toSee('CPU limit must be greater than 0')
    await page.screenshot('.tmp/issue-206-app-validation-dark.png', {
      fullPage: true
    })

    await page.fill('#cpuLimit', '1.25')
    await page.raw.locator('#cpu-limit-error').waitFor({ state: 'hidden' })
    await page.raw.waitForTimeout(500)
    const saved = page.raw.waitForResponse(
      (response) =>
        response
          .url()
          .endsWith(
            `/api/v1/projects/${project.slug}/environments/${environment.slug}/apps/${app.slug}`
          ) && response.request().method() === 'PATCH'
    )
    await page.raw
      .locator('form')
      .first()
      .locator('button[type="submit"]')
      .click()
    expect((await saved).status()).toBe(200)

    expect(page).toHaveNoJavascriptErrors()
  }
)
