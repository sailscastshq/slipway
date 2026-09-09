const { test } = require('sounding')
const fs = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')
test(
  'Shipwright renders Slipway assets through Sails and preserves Vue HMR',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'shipwright-check' } }
    }
  },
  async ({ page, expect, sails }) => {
    const source = path.resolve('assets/js/pages/auth/login.vue')
    const original = await fs.readFile(source, 'utf8')
    const artifactRoot = path.resolve(
      process.env.SLIPWAY_ASSET_ARTIFACT_DIR ||
        '.tmp/sounding/artifacts/shipwright'
    )
    await fs.mkdir(artifactRoot, { recursive: true })
    try {
      await page.goto('/login')
      await expect(page.raw.locator('#email')).toBeVisible()
      await expect(
        page.raw.getByRole('heading', { name: 'Slipway', exact: true })
      ).toBeVisible()
      await page.raw.locator('#email').fill('hmr@example.test')
      await page.raw.evaluate(() => {
        window.__shipwrightSameDocument = 'preserved'
      })
      assert.equal(
        await page.raw
          .locator('#email')
          .evaluate((el) => getComputedStyle(el).borderBottomStyle),
        'dashed'
      )
      assert.equal(
        await page.raw
          .locator('#email')
          .evaluate((el) => getComputedStyle(el).height),
        '48px'
      )
      assert.ok(
        await page.raw
          .locator('script[src]')
          .evaluateAll((nodes) =>
            nodes.every((node) => new URL(node.src).origin === location.origin)
          )
      )
      {
        await fs.writeFile(
          source,
          original.replace(
            '<Head title="Login | Slipway" />',
            '<Head title="Login | Slipway" /><span data-shipwright-hmr="ready">HMR verified</span>'
          )
        )
        await expect(
          page.raw.locator('[data-shipwright-hmr="ready"]')
        ).toBeVisible({ timeout: 30000 })
        assert.equal(
          await page.raw.evaluate(() => window.__shipwrightSameDocument),
          'preserved'
        )
        await expect(page.raw.locator('#email')).toHaveValue('hmr@example.test')
        await fs.writeFile(source, original)
        await expect(
          page.raw.locator('[data-shipwright-hmr="ready"]')
        ).toHaveCount(0)
      }
      for (const [width, colorScheme] of [
        [1280, 'light'],
        [390, 'dark']
      ]) {
        await page.raw.setViewportSize({ width, height: 850 })
        await page.raw.emulateMedia({ colorScheme })
        assert.equal(
          await page.raw.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          ),
          true
        )
        await page.screenshot(
          path.join(artifactRoot, `development-${width}.png`),
          { animations: 'disabled' }
        )
      }
      expect(page).toHaveNoJavascriptErrors()
      console.log(
        `Vue HMR verified through Sails on ${
          sails.hooks.http.server.address().port
        }`
      )
    } finally {
      await fs.writeFile(source, original)
    }
  }
)
