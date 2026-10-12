const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { test } = require('sounding')

test(
  'Bearing feedback attachments keep focus and scrolling inside their pills',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'bearing-attachments',
          name: 'Bearing Attachments'
        }
      }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current
    const app = current.apps.web
    const environment = current.environments.production
    const project = current.projects.deploymentTarget
    const space = await sails.models.bearingspace
      .create({
        publicSlug: 'bearing-attachments',
        app: app.id,
        createdBy: current.users.genesisUser.id
      })
      .fetch()
    const titles = [
      'Keep feedback selection in place',
      'A long feedback title ' + 'with useful context '.repeat(5),
      'AnUnbrokenFeedbackTitle' + 'x'.repeat(100)
    ]
    for (let i = 0; i < 15; i++)
      await sails.models.bearingfeedback.create({
        title:
          titles[i] ||
          `Request ${i + 1}: improve the customer feedback workflow`,
        category: 'feature',
        app: app.id,
        space: space.id
      })
    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await expect(page.raw).toHaveURL(/\/$/)
    const stage = process.env.BEARING_ATTACHMENT_STAGE || 'fixed'
    const root = path.resolve(`.tmp/screenshots/bearing-attachments/${stage}`)
    fs.mkdirSync(root, { recursive: true })
    const measurements = []
    await page.goto(
      `/projects/${project.slug}/environments/${environment.slug}/apps/${app.slug}/bearing?view=updates`
    )
    const input = page.raw.getByLabel(titles[0], { exact: true })
    const pill = input.locator('..')
    async function measure(label) {
      await page.raw.evaluate(async () => {
        for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame)
      })
      const geometry = await page.raw.evaluate(() => {
        const input = [
          ...document.querySelectorAll('input[type=checkbox]')
        ].find((el) =>
          el.parentElement.textContent.includes(
            'Keep feedback selection in place'
          )
        )
        const box = (el) => {
          const r = el.getBoundingClientRect()
          return {
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            scrollTop: el.scrollTop,
            scrollHeight: el.scrollHeight,
            clientHeight: el.clientHeight,
            scrollWidth: el.scrollWidth,
            clientWidth: el.clientWidth
          }
        }
        return {
          viewport: { width: innerWidth, height: innerHeight },
          document: box(document.scrollingElement),
          mains: [...document.querySelectorAll('main')].map(box),
          input: box(input),
          pill: box(input.parentElement),
          picker: box(input.parentElement.parentElement),
          inputPosition: getComputedStyle(input).position,
          offsetParent: input.offsetParent?.tagName,
          focused: document.activeElement === input
        }
      })
      measurements.push({ label, ...geometry })
      await page.screenshot(path.join(root, `${label}.png`), {
        fullPage: true,
        animations: 'disabled'
      })
      return geometry
    }
    for (const [size, width, height] of [
      ['desktop', 1440, 1000],
      ['mobile', 390, 700]
    ]) {
      await page.resize(width, height)
      for (const scheme of ['light', 'dark']) {
        await page.raw.emulateMedia({ colorScheme: scheme })
        await pill.scrollIntoViewIfNeeded()
        const before = await measure(`${size}-${scheme}-before`)
        await pill.click()
        await expect(input).toBeChecked()
        const selected = await measure(`${size}-${scheme}-selected`)
        await pill.click()
        await expect(input).not.toBeChecked()
        const removed = await measure(`${size}-${scheme}-removed`)
        if (stage !== 'baseline') {
          for (const state of [selected, removed]) {
            assert.ok(
              Math.abs(state.mains[0].scrollTop - before.mains[0].scrollTop) <=
                1,
              JSON.stringify({ before, state })
            )
            assert.equal(state.document.scrollTop, 0)
            assert.ok(state.document.scrollHeight <= height + 1)
            assert.ok(
              state.input.y >= state.pill.y &&
                state.input.y <= state.pill.y + state.pill.height
            )
            assert.ok(state.picker.scrollWidth <= state.picker.clientWidth + 1)
            assert.ok(state.mains[0].scrollWidth <= width + 1)
            assert.ok(state.picker.width <= width)
          }
        }
        await page.raw.getByRole('link', { name: 'Finish setup' }).focus()
        await page.raw.keyboard.press('Tab')
        await expect(input).toBeFocused()
        await input.press('Space')
        await expect(input).toBeChecked()
        await expect(input).toBeFocused()
        await input.press('Space')
        await expect(input).not.toBeChecked()
        for (const title of titles.slice(1)) {
          const long = page.raw.getByLabel(title, { exact: true })
          await long.locator('..').scrollIntoViewIfNeeded()
          const longBefore = await page.raw
            .locator('main')
            .first()
            .evaluate((el) => el.scrollTop)
          await long.locator('..').click()
          await expect(long).toBeChecked()
          await long.press('Space')
          await expect(long).not.toBeChecked()
          if (stage !== 'baseline') {
            assert.equal(
              await page.raw.evaluate(
                () => document.scrollingElement.scrollTop
              ),
              0
            )
            assert.ok(
              Math.abs(
                (await page.raw
                  .locator('main')
                  .first()
                  .evaluate((el) => el.scrollTop)) - longBefore
              ) <= 1
            )
          }
        }
        await input.locator('..').scrollIntoViewIfNeeded()
        await measure(`${size}-${scheme}-keyboard-long`)
        const containment = await page.raw.evaluate(() => {
          const picker = document.querySelector('input[type=checkbox]')
            .parentElement.parentElement
          picker.scrollTop = picker.scrollHeight
          const main = document.querySelector('main')
          main.scrollTop = main.scrollHeight
          return {
            documentScroll: document.scrollingElement.scrollTop,
            pickerRange: picker.scrollHeight - picker.clientHeight,
            pickerScroll: picker.scrollTop,
            mainRange: main.scrollHeight - main.clientHeight,
            mainScroll: main.scrollTop
          }
        })
        if (stage !== 'baseline') {
          assert.equal(containment.documentScroll, 0)
          assert.ok(
            Math.abs(containment.pickerRange - containment.pickerScroll) <= 1
          )
          assert.ok(
            Math.abs(containment.mainRange - containment.mainScroll) <= 1
          )
        }
      }
    }
    fs.writeFileSync(
      path.join(root, 'geometry.json'),
      JSON.stringify(measurements, null, 2)
    )
    expect(page).toHaveNoJavascriptErrors()
  }
)
