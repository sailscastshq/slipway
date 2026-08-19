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
    const precognitionScreenshotRoot = path.resolve(
      '.tmp/screenshots/issue-208-precognition'
    )
    const breadcrumbScreenshotRoot = path.resolve(
      '.tmp/screenshots/issue-355-breadcrumb/after'
    )
    const projectRoot = path.join(
      tempRoot,
      current.projects.deploymentTarget.slug
    )
    const collectionRoot = path.join(projectRoot, 'content', 'posts')
    const originalAppsDir = sails.config.custom.slipwayAppsDir
    const originalGetContainerStatus = sails.helpers.docker.getContainerStatus

    fs.mkdirSync(precognitionScreenshotRoot, { recursive: true })
    fs.mkdirSync(breadcrumbScreenshotRoot, { recursive: true })
    fs.mkdirSync(collectionRoot, { recursive: true })
    fs.writeFileSync(
      path.join(collectionRoot, 'welcome.md'),
      [
        '---',
        'title: Welcome aboard',
        'description: A calmer way to ship',
        '---',
        '',
        '# A calmer way to ship',
        '',
        'Slipway keeps **content**, code, and releases in one legible workflow.',
        '',
        '- Write without CMS clutter',
        '- Commit ordinary Markdown',
        '- Deploy when the story is ready',
        ''
      ].join('\n')
    )
    fs.writeFileSync(
      path.join(collectionRoot, 'empty.md'),
      '---\ntitle: Untitled\n---\n\n'
    )
    fs.writeFileSync(
      path.join(collectionRoot, 'advanced.md'),
      '---\ntitle: Research notes\n---\n\nA preserved note[^1].\n\n[^1]: Source-only syntax.\n'
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
      await page.raw.route('**/api/v1/system/check-update', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ updateAvailable: false })
        })
      })

      await login.withPassword('genesisUser', page, {
        password: current.auth.genesisUserPassword
      })
      await page.raw.waitForURL((url) => !url.pathname.startsWith('/login'), {
        timeout: 10000
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
      await page.wait('@content-visual-editor')
      await expect(page).toSee('A calmer way to ship')
      const breadcrumb = page.raw.locator('[data-slot="breadcrumb"]')
      expect(await breadcrumb.count()).toBe(1)
      expect(await breadcrumb.locator('[data-slot="list"]').count()).toBe(1)
      expect(
        await breadcrumb.locator('[aria-current="page"]').textContent()
      ).toBe('welcome')
      expect(await breadcrumb.locator('[data-slot="link"]').count()).toBe(4)
      expect(
        await breadcrumb.locator('[data-slot="link"]').allTextContents()
      ).toEqual(['projects', 'content manager ui', 'production', 'content'])
      expect(
        await breadcrumb.locator('[data-slot="item"]:visible').allTextContents()
      ).toEqual(['projects', 'posts', 'welcome'])
      await expect(
        breadcrumb.locator('[data-slot="ellipsis"]:visible')
      ).toHaveCount(1)
      await page.screenshot('.tmp/content-editor-populated-light.png', {
        fullPage: true
      })
      await page.screenshot(
        path.join(breadcrumbScreenshotRoot, 'content-editor-desktop-light.png'),
        { fullPage: true }
      )
      expect(await breadcrumb.locator('[data-slot="current"] a').count()).toBe(
        0
      )
      const projectsBreadcrumbLink = breadcrumb
        .locator('[data-slot="link"]')
        .first()
      expect(await projectsBreadcrumbLink.getAttribute('href')).toBe('/')
      await projectsBreadcrumbLink.focus()
      expect(
        await projectsBreadcrumbLink.evaluate(
          (element) => document.activeElement === element
        )
      ).toBe(true)

      await page.raw.emulateMedia({ colorScheme: 'dark' })
      await page.screenshot('.tmp/content-editor-populated-dark.png', {
        fullPage: true
      })
      await page.raw.emulateMedia({ colorScheme: 'light' })

      await page.goto(`${basePath}/posts/empty?${appScope}`)
      await page.wait('@content-visual-editor')
      await page.screenshot('.tmp/content-editor-empty-light.png', {
        fullPage: true
      })

      const visualEditor = page.raw.locator(
        '[data-test="content-visual-editor"]'
      )
      await visualEditor.click()
      await visualEditor.pressSequentially('# ')
      await visualEditor.pressSequentially('Release notes')
      await visualEditor.press('Enter')
      await visualEditor.pressSequentially(
        'Ship with **confidence** and keep the file reviewable.'
      )

      expect(await visualEditor.locator('h1').textContent()).toBe(
        'Release notes'
      )
      expect(await visualEditor.locator('strong').textContent()).toBe(
        'confidence'
      )
      await page.screenshot('.tmp/content-editor-written-light.png', {
        fullPage: true
      })

      await visualEditor.locator('strong').selectText()
      await page.wait('@content-format-menu')
      await page.screenshot('.tmp/content-editor-format-menu-light.png', {
        fullPage: true
      })
      await page.raw.getByRole('button', { name: 'Bold' }).click()
      expect(await visualEditor.locator('strong').count()).toBe(0)
      await visualEditor.press('ControlOrMeta+z')
      expect(await visualEditor.locator('strong').textContent()).toBe(
        'confidence'
      )

      await page.click('@content-source-mode')
      const markdownSource = page.raw.locator(
        '[data-test="content-markdown-source"]'
      )
      expect(await markdownSource.inputValue()).toContain('# Release notes')
      expect(await markdownSource.inputValue()).toContain('**confidence**')

      await page.click('@content-visual-mode')
      await page.wait('@content-visual-editor')
      await visualEditor.evaluate((element) => {
        const clipboard = new DataTransfer()
        clipboard.setData(
          'text/html',
          '<p>Safe paste<script>window.__unsafePaste = true</script><a href="javascript:alert(1)">bad link</a></p>'
        )
        clipboard.setData('text/plain', 'Safe paste bad link')
        element.dispatchEvent(
          new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: clipboard
          })
        )
      })
      expect(await visualEditor.locator('script').count()).toBe(0)
      expect(await visualEditor.locator('a[href^="javascript:"]').count()).toBe(
        0
      )

      await page.click('@content-save-menu-toggle')
      await page.wait('@content-save-menu')
      await expect(page).toSee('Save & Deploy')
      expect(await page.raw.getByText('Target app').count()).toBe(0)

      await page.goto(`${basePath}/posts/advanced?${appScope}`)
      await page.wait('@content-source-warning')
      expect(
        await page.raw.locator('[data-test="content-visual-mode"]').isDisabled()
      ).toBe(true)
      await page.screenshot('.tmp/content-editor-source-warning-light.png', {
        fullPage: true
      })

      await page.goto(`${basePath}/posts/welcome?${appScope}`)
      await page.resize(390, 844)
      await page.wait('@content-visual-editor')
      expect(await breadcrumb.count()).toBe(1)
      expect(
        await breadcrumb.locator('[data-slot="item"]:visible').allTextContents()
      ).toEqual(['welcome'])
      await page.screenshot('.tmp/content-editor-mobile-light.png', {
        fullPage: true
      })
      await page.screenshot(
        path.join(breadcrumbScreenshotRoot, 'content-editor-mobile-light.png'),
        { fullPage: true }
      )

      await page.resize(1440, 900)
      await page.goto(`${basePath}?${appScope}`)
      await page.click('@content-new-button')
      await page.wait('@content-create-modal')
      await expect(page).toSee('Create new content in posts')
      expect(await page.raw.getByText('Target app').count()).toBe(0)
      const contentSlug = page.raw.getByPlaceholder('my-new-post')
      await contentSlug.fill('Release Notes')
      await contentSlug.blur()
      await page.wait('text=Use lowercase letters')
      await page.screenshot(
        path.join(precognitionScreenshotRoot, 'content-slug-error-light.png'),
        { fullPage: true }
      )
      await page.raw.emulateMedia({ colorScheme: 'dark' })
      await page.screenshot(
        path.join(precognitionScreenshotRoot, 'content-slug-error-dark.png'),
        { fullPage: true }
      )
      await page.raw.emulateMedia({ colorScheme: 'light' })
      await contentSlug.fill('release-notes')
      await page.raw
        .getByText('Use lowercase letters', { exact: false })
        .waitFor({ state: 'hidden' })
      expect(
        await page.raw
          .getByRole('button', { name: 'Create' })
          .getAttribute('class')
      ).toContain('bg-gray-900')
      await page.screenshot('.tmp/content-manager-create.png', {
        fullPage: true
      })
      await page.raw.getByRole('button', { name: 'Create' }).click()
      await page.raw.waitForURL(
        (url) => url.pathname.endsWith('/content/posts/release-notes'),
        { timeout: 10000 }
      )
      expect(fs.existsSync(path.join(collectionRoot, 'release-notes.md'))).toBe(
        true
      )
      expect(page).toHaveNoJavascriptErrors()
    } finally {
      sails.helpers.docker.getContainerStatus = originalGetContainerStatus
      sails.config.custom.slipwayAppsDir = originalAppsDir
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  }
)
