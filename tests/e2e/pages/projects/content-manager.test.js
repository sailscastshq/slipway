const fs = require('fs')
const os = require('os')
const path = require('path')

const { test } = require('sounding')

test(
  'Content Manager keeps app targeting inside its existing save and create UI',
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

    try {
      await login.withPassword('genesisUser', page, {
        password: current.auth.genesisUserPassword
      })

      const basePath = `/projects/${current.projects.deploymentTarget.slug}/content`
      await page.goto(`${basePath}/posts/welcome`)
      await page.fill('@content-body', 'A polished Content Manager draft.')
      await page.click('@content-save-menu-toggle')
      await page.wait('@content-save-menu')
      await expect(page).toSee('Target app')
      await expect(page).toSee('Save & Deploy')
      await page.raw
        .locator('[data-test="content-target-app"]')
        .selectOption(current.apps.web.slug)
      expect(page.raw.url().includes(`appSlug=${current.apps.web.slug}`)).toBe(
        true
      )
      await page.screenshot('.tmp/content-manager-save-deploy.png', {
        fullPage: true
      })

      await page.goto(basePath)
      await page.click('@content-new-button')
      await page.wait('@content-create-modal')
      await expect(page).toSee('Create new content in posts')
      await expect(page).toSee('Target app')
      await page.screenshot('.tmp/content-manager-create.png', {
        fullPage: true
      })
      expect(page).toHaveNoJavascriptErrors()
    } finally {
      sails.config.custom.slipwayAppsDir = originalAppsDir
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  }
)
