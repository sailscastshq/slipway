const { test } = require('node:test')
const { createRequire } = require('node:module')
const req = createRequire(process.cwd() + '/package.json')
const { chromium, expect } = req('@playwright/test')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
test('shared selects preserve underline, states, focus and recipient selection across themes and viewports', async () => {
  await require('../fixtures/select-audit/build.cjs')()
  const dist = path.resolve('.tmp/select803-dist')
  const server = http.createServer((request, response) => {
    if (request.url.startsWith('/fixture/people')) {
      response.setHeader('Content-Type', 'application/json')
      return response.end(
        JSON.stringify({
          options: [
            { value: 'a', label: 'Ada Fixture' },
            { value: 'b', label: 'Bea Fixture' }
          ],
          hasMore: false
        })
      )
    }
    const file = path.join(
      dist,
      request.url === '/' ? 'index.html' : request.url
    )
    response.setHeader(
      'Content-Type',
      file.endsWith('.js')
        ? 'application/javascript'
        : file.endsWith('.css')
        ? 'text/css'
        : 'text/html'
    )
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.statusCode = 404
      return response.end()
    }
    response.end(fs.readFileSync(file))
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  let browser
  try {
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${server.address().port}`)
    await page.locator('#currency').waitFor()
    fs.mkdirSync('.tmp/select803-evidence', { recursive: true })
    for (const width of [1440, 390])
      for (const dark of [false, true]) {
        await page.setViewportSize({ width, height: 900 })
        await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' })
        await page.evaluate((d) => {
          document.documentElement.classList.toggle('dark', d)
          document.body.style.background = d ? '#171717' : '#fff'
        }, dark)
        const currency = page.locator('#currency')
        for (const id of ['currency', 'disabled', 'invalid', 'recipients']) {
          const chrome = await page.locator('#' + id).evaluate((el) => {
            const s = getComputedStyle(el),
              r = el.getBoundingClientRect()
            return {
              top: s.borderTopWidth,
              right: s.borderRightWidth,
              left: s.borderLeftWidth,
              bottom: s.borderBottomWidth,
              line: s.borderBottomStyle,
              radius: s.borderRadius,
              inside: r.right <= innerWidth && r.left >= 0,
              color: s.borderBottomColor
            }
          })
          expect(chrome).toMatchObject({
            top: '0px',
            right: '0px',
            left: '0px',
            bottom: '1px',
            line: 'dashed',
            radius: '0px',
            inside: true
          })
          if (id === 'invalid')
            await expect(page.locator('#invalid')).toHaveCSS(
              'border-bottom-color',
              dark ? 'rgb(248, 113, 113)' : 'rgb(239, 68, 68)'
            )
        }
        await expect(page.locator('#disabled')).toBeDisabled()
        await currency.focus()
        await currency.press('Space')
        await expect(currency).toHaveAttribute('aria-expanded', 'true')
        await page.screenshot({
          path:
            '.tmp/select803-evidence/' +
            width +
            '-' +
            (dark ? 'dark' : 'light') +
            '.png'
        })
        await currency.press('Escape')
        await expect(currency).toBeFocused()
        await page.screenshot({
          path: `.tmp/select803-evidence/${width}-${
            dark ? 'dark' : 'light'
          }-closed.png`
        })
      }
    const c = page.locator('#currency')
    await c.press('Space')
    await c.press('End')
    await c.press('Enter')
    await expect(c.locator('[data-test=selected-value]')).toHaveText('EUR')
    expect(
      await page
        .locator('form')
        .evaluate((el) => new FormData(el).get('currency'))
    ).toBe('eur')
    await c.press('Space')
    await c.press('Tab')
    await expect(c).not.toBeFocused()
    await expect(c).toHaveAttribute('aria-expanded', 'false')
    const people = page.locator('#recipients')
    await people.click()
    await page.getByRole('option', { name: 'Ada Fixture', exact: true }).click()
    await expect(page.getByText('1 selected', { exact: true })).toBeVisible()
    await expect(page.getByText('Ada Fixture', { exact: true })).toBeVisible()
    expect(errors).toEqual([])
    console.log(
      'PASS: four theme/viewport combinations; dashed chrome, invalid border, disabled, keyboard skip-disabled, Escape/Tab focus, form serialization, recipient selection'
    )
  } finally {
    await browser?.close()
    await new Promise((r) => server.close(r))
  }
})
