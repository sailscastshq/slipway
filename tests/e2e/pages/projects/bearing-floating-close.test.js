const { test } = require('sounding')
const fs = require('node:fs')
const path = require('node:path')
for (const browser of ['desktop', 'mobile'])
  test(
    `Bearing floating launcher dismisses every host opening on ${browser}`,
    {
      browser,
      world: {
        name: 'configured-slipway',
        context: {
          deploymentTarget: {
            slug: `floating-close-${browser}`,
            name: 'Northstar'
          }
        }
      }
    },
    async ({ sails, world, page, login, expect }) => {
      const { apps, environments, projects, users, auth } = world.current
      const app = apps.web
      await sails.models.app
        .updateOne({ id: app.id })
        .set({ bearingEnabled: true })
      const space = await sails.models.bearingspace
        .create({
          app: app.id,
          publicSlug: `floating-${browser}`,
          createdBy: users.genesisUser.id,
          widgetEnabled: true,
          allowAnonymousParticipation: true,
          showUnread: false
        })
        .fetch()
      const privatePath = `/_slipway/bearing/host/${projects.deploymentTarget.slug}/${environments.production.slug}/${app.slug}`
      await page.raw.route('**/bearing/**', async (route) => {
        const url = new URL(route.request().url())
        if (url.pathname.startsWith('/bearing/'))
          url.pathname = privatePath + url.pathname.slice('/bearing'.length)
        else if (url.pathname.startsWith('/_slipway/bearing/_assets/'))
          url.pathname = url.pathname.replace('/_slipway/bearing/_assets', '')
        else if (
          /^\/_slipway\/bearing\/(bootstrap.js|widget-config|widget.css|appearance.css)$/.test(
            url.pathname
          )
        )
          url.pathname = privatePath + '/' + url.pathname.split('/').pop()
        await route.continue({ url: url.toString() })
      })
      await login.withPassword('genesisUser', page, {
        password: auth.genesisUserPassword
      })
      await page.resize(
        browser === 'mobile' ? 390 : 1440,
        browser === 'mobile' ? 844 : 1000
      )
      await page.raw.emulateMedia({ reducedMotion: 'reduce' })
      await page.goto('/bearing/feedback')
      await page.raw.evaluate(() => {
        const button = document.createElement('button')
        button.id = 'host-open'
        button.dataset.slipwayBearingOpen = 'feedback'
        button.textContent = 'Send feedback'
        document.body.prepend(button)
        const script = document.createElement('script')
        script.src = '/_slipway/bearing/bootstrap.js'
        document.body.append(script)
      })
      const widget = page.raw.locator('[data-slipway-bearing-widget]')
      await expect(widget).toBeAttached()
      const trigger = widget.locator('[data-trigger]'),
        panel = widget.locator('[data-panel]')
      const opener = page.raw.locator('#host-open')
      await expect(trigger).toBeHidden()
      for (let attempt = 0; attempt < 2; attempt++) {
        await opener.click()
        await expect(panel).toBeVisible()
        await expect(trigger).toBeVisible()
        await expect(trigger).toHaveAccessibleName(
          'Close what’s new for Northstar'
        )
        await expect(trigger).toHaveAttribute('aria-expanded', 'true')
        await expect(trigger).toBeFocused()
        await expect(widget.locator('[data-close]')).toHaveCount(0)
        const dialogBounds = await panel.boundingBox(),
          closeBounds = await trigger.boundingBox()
        expect(closeBounds.y >= dialogBounds.y + dialogBounds.height).toBe(true)
        expect(
          closeBounds.y + closeBounds.height <=
            (browser === 'mobile' ? 844 : 1000)
        ).toBe(true)
        if (!attempt) await trigger.click()
        else await trigger.press('Escape')
        await expect(panel).not.toBeVisible()
        await expect(trigger).toBeHidden()
        await expect(opener).toBeFocused()
      }
      await page.raw.evaluate(() =>
        window.dispatchEvent(
          new CustomEvent('slipway:bearing:open', {
            detail: { surface: 'feedback' }
          })
        )
      )
      await expect(trigger).toBeVisible()
      await expect(trigger).toHaveAccessibleName(
        'Close what’s new for Northstar'
      )
      await page.raw
        .frameLocator('[data-slipway-bearing-widget] iframe')
        .getByLabel('Summary')
        .focus()
      await page.raw
        .frameLocator('[data-slipway-bearing-widget] iframe')
        .getByLabel('Summary')
        .press('Escape')
      await expect(panel).not.toBeVisible()
      await expect(opener).toBeFocused()
      await expect(trigger).toBeHidden()
      const output = path.resolve('.tmp/screenshots/appearance-followup')
      fs.mkdirSync(output, { recursive: true })
      await opener.click()
      await page.screenshot(
        path.join(output, `${browser}-data-button-floating-close.png`)
      )
      await trigger.click()
      await expect(trigger).toBeHidden()
      expect(page).toHaveNoJavascriptErrors()
    }
  )
