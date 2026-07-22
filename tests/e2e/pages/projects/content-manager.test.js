const fs = require('fs')
const os = require('os')
const path = require('path')

const { test } = require('sounding')

test(
  'Content Manager inherits app scope and keeps the existing Slipway UI',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'content-manager-ui',
          name: 'Content Manager UI'
        }
      }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'slipway-content-manager-ui-')
    )
    const projectRoot = path.join(
      tempRoot,
      current.projects.deploymentTarget.slug
    )
    const collectionRoot = path.join(projectRoot, 'content', 'posts')
    const originalAppsDir = sails.config.custom.slipwayAppsDir
    const originalGetContainerStatus = sails.helpers.docker.getContainerStatus

    fs.mkdirSync(collectionRoot, { recursive: true })
    fs.writeFileSync(
      path.join(collectionRoot, 'welcome.md'),
      '---\ntitle: Welcome\n---\n\nHello.\n'
    )
    fs.writeFileSync(path.join(projectRoot, 'Dockerfile'), 'FROM node:22\n')
    sails.config.custom.slipwayAppsDir = tempRoot

    await sails.models.environment
      .updateOne({ id: current.environments.production.id })
      .set({
        features: {
          'sails-content': {
            version: '1.0.0',
            contentDir: 'content'
          }
        }
      })
    await world.create('app').with({
      name: 'Worker',
      slug: 'worker',
      environment: current.environments.production.id,
      isDefault: false,
      routePath: null
    })
    await sails.models.app
      .updateOne({ id: current.apps.web.id })
      .set({ status: 'running', containerName: 'content-manager-ui-web' })
    sails.helpers.docker.getContainerStatus = async () => ({
      running: true,
      health: 'healthy'
    })

    try {
      await login.withPassword('genesisUser', page, {
        password: current.auth.genesisUserPassword
      })

      const basePath = `/projects/${current.projects.deploymentTarget.slug}/environments/${current.environments.production.slug}/content`
      const appScope = `appSlug=${current.apps.web.slug}`
      await page.goto(
        `/projects/${current.projects.deploymentTarget.slug}/environments/${current.environments.production.slug}/apps/${current.apps.web.slug}`
      )
      await page.click('@app-more-menu')
      expect(
        await page.raw.locator(`a[href="${basePath}?${appScope}"]`).count()
      ).toBe(1)
      await page.goto(`${basePath}/posts/welcome?${appScope}`)
      await page.fill('@content-body', 'A polished Content Manager draft.')
      await page.click('@content-save-menu-toggle')
      await page.wait('@content-save-menu')
      await expect(page).toSee('Save & Deploy')
      expect(await page.raw.getByText('Target app').count()).toBe(0)
      await page.screenshot('.tmp/content-manager-save-deploy.png', {
        fullPage: true
      })

      await page.goto(`${basePath}?${appScope}`)
      await page.click('@content-new-button')
      await page.wait('@content-create-modal')
      await expect(page).toSee('Create new content in posts')
      expect(await page.raw.getByText('Target app').count()).toBe(0)
      await page.raw.getByPlaceholder('my-new-post').fill('release-notes')
      expect(
        await page.raw
          .getByRole('button', { name: 'Create' })
          .getAttribute('class')
      ).toContain('bg-gray-900')
      await page.screenshot('.tmp/content-manager-create.png', {
        fullPage: true
      })
      expect(page).toHaveNoJavascriptErrors()
    } finally {
      sails.helpers.docker.getContainerStatus = originalGetContainerStatus
      sails.config.custom.slipwayAppsDir = originalAppsDir
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  }
)
