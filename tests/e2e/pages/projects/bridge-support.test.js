const { test } = require('sounding')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const supportHost = require('../../../support/bridge-support-host')
for (const prefix of ['', '/academy'])
  test(
    `support banner stays visible on desktop and mobile and preserves login (${
      prefix || 'root'
    })`,
    {
      browser: true,
      world: {
        name: 'configured-slipway',
        context: {
          deploymentTarget: {
            slug: prefix ? 'support-ui-prefix' : 'support-ui'
          }
        }
      }
    },
    async ({ sails, world, page, expect }) => {
      const target = await supportHost(sails, world, { prefix })
      const output = path.resolve('output/issue-500')
      await fs.mkdir(output, { recursive: true })
      try {
        await page.goto(target.origin + prefix + '/login')
        const { code } = await target.issue()
        await page.goto(
          target.origin +
            prefix +
            '/_slipway/bridge/impersonation/start#' +
            code
        )
        const banner = page.raw.locator('#slipway-support-banner')
        await expect(banner).toContainText('Viewing as Ada Customer')
        await expect(
          page.raw.getByRole('heading', { name: 'customer', exact: true })
        ).toBeVisible()
        assert.ok(!page.raw.url().includes(code))
        for (const [width, colorScheme] of [
          [1280, 'light'],
          [390, 'dark']
        ]) {
          await page.raw.setViewportSize({ width, height: 900 })
          await page.raw.emulateMedia({ colorScheme })
          assert.equal(
            await banner.evaluate((el) => getComputedStyle(el).position),
            'fixed'
          )
          assert.equal(
            await page.raw.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth
            ),
            true
          )
          await banner.screenshot({
            path: path.join(
              output,
              `support-banner-${width}${prefix ? '-prefix' : ''}.png`
            )
          })
        }
        await page.raw.reload()
        await expect(banner).toContainText('Read only')
        await banner
          .getByRole('link', { name: 'Stop viewing', exact: true })
          .click()
        await page.goto(target.origin + prefix + '/')
        await expect(
          page.raw.getByRole('heading', { name: 'operator', exact: true })
        ).toBeVisible()
        await expect(banner).toHaveCount(0)
      } finally {
        await target.close()
      }
    }
  )
