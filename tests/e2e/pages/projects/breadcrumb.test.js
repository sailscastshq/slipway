const fs = require('node:fs')
const path = require('node:path')
const { test } = require('sounding')

test(
  'shared breadcrumbs remain visible in deployment and environment headers',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'breadcrumb-visibility',
          name: 'Breadcrumb visibility',
          failure: 'Fixture deployment failed'
        }
      }
    }
  },
  async ({ world, login, page, expect }) => {
    const current = world.current
    const project = current.projects.deploymentTarget
    const deployment = current.deployments.failed
    const root = path.resolve('.github/screenshots/breadcrumb-visibility')
    fs.mkdirSync(root, { recursive: true })
    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    for (const width of [1440, 390]) {
      await page.raw.setViewportSize({ width, height: 900 })
      await page.raw.emulateMedia({ colorScheme: 'dark' })
      await page.goto(`/projects/${project.slug}/deployments/${deployment.id}`)
      const nav = page.raw.getByRole('navigation', {
        name: 'Breadcrumb',
        exact: true
      })
      const currentCrumb = nav.locator('[aria-current="page"]')
      await expect(currentCrumb).toContainText(String(deployment.id))
      const visible = await currentCrumb.evaluate((element) => {
        const box = element.getBoundingClientRect()
        const nav = element.closest('nav').getBoundingClientRect()
        return (
          box.width > 0 &&
          nav.width > 0 &&
          box.right <= nav.right + 1 &&
          box.right <= window.innerWidth
        )
      })
      expect(visible).toBe(true)
      await page.screenshot(path.join(root, `deployment-${width}.png`))
      await nav.getByRole('link', { name: 'production', exact: true }).click()
      await page.raw.waitForURL(
        `**/projects/${project.slug}/environments/production`
      )
      await expect(
        page.raw.locator('[data-slot="breadcrumb"] [aria-current="page"]')
      ).toContainText('production')
      const navWidth = await nav.evaluate(
        (element) => element.getBoundingClientRect().width
      )
      expect(navWidth > 100).toBe(true)
      const docs = page.raw.getByRole('link', { name: 'Docs', exact: true })
      const docsBox = await docs.boundingBox()
      expect(docsBox.x + docsBox.width <= width).toBe(true)
      const trailBox = await nav.boundingBox()
      expect(trailBox.x + trailBox.width <= docsBox.x).toBe(true)
      await page.screenshot(path.join(root, `environment-${width}.png`))
    }
    expect(page).toHaveNoSmoke()
  }
)
