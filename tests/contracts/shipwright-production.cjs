const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const { chromium } = require('playwright')
const { Sails } = require('sails')
;(async () => {
  const root = process.cwd(),
    errors = []
  const artifactRoot = path.resolve(
    process.env.SLIPWAY_ASSET_ARTIFACT_DIR ||
      '.tmp/sounding/artifacts/shipwright'
  )
  await fs.mkdir(artifactRoot, { recursive: true })
  const logger = Object.fromEntries(
    ['verbose', 'silly', 'info', 'warn', 'debug', 'error'].map((key) => [
      key,
      (...args) => {
        if (key === 'error') errors.push(args)
        console.log(...args)
      }
    ])
  )
  const app = {
    config: {
      appPath: root,
      port: 0,
      shipwright: {
        styles: {},
        js: {},
        ...require('../../config/shipwright').shipwright
      }
    },
    log: logger
  }
  const hook = require('sails-hook-shipwright')(app)
  hook.configure()
  await hook.initialize()
  assert.deepEqual(errors, [], 'production build must succeed')
  const manifest = JSON.parse(
    await fs.readFile('.tmp/public/manifest.json', 'utf8')
  )
  assert.ok(manifest.entries.app.initial.js.length)
  assert.ok(manifest.entries.app.initial.css.length)
  const html = require('ejs').render(
    await fs.readFile('views/app.ejs', 'utf8'),
    {
      shipwright: app.config.views.locals.shipwright,
      page: {
        component: 'auth/login',
        props: {},
        url: '/login',
        version: 'asset-check'
      }
    },
    { filename: path.join(root, 'views/app.ejs') }
  )
  const fixture = await fs.mkdtemp(
    path.join(os.tmpdir(), 'slipway-prod-assets-')
  )
  const server = new Sails()
  let browser
  try {
    await new Promise((resolve, reject) =>
      server.lift(
        {
          appPath: fixture,
          environment: 'production',
          loadHooks: ['http'],
          globals: false,
          port: 0,
          explicitHost: '127.0.0.1',
          paths: { public: path.join(root, '.tmp/public') },
          routes: { 'GET /login': (req, res) => res.send(html) },
          log: { level: 'error' }
        },
        (err) => (err ? reject(err) : resolve())
      )
    )
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage(),
      failures = []
    page.on('pageerror', (e) => failures.push(e.message))
    page.on('response', (r) => {
      if (r.status() >= 400) failures.push(`${r.status()} ${r.url()}`)
    })
    await page.goto(
      `http://127.0.0.1:${server.hooks.http.server.address().port}/login`
    )
    await page.locator('#email').waitFor()
    assert.equal(
      await page
        .locator('#email')
        .evaluate((el) => getComputedStyle(el).borderBottomStyle),
      'dashed'
    )
    assert.equal(
      await page
        .locator('#email')
        .evaluate((el) => getComputedStyle(el).height),
      '48px'
    )
    for (const [width, colorScheme] of [
      [1280, 'light'],
      [390, 'dark']
    ]) {
      await page.setViewportSize({ width, height: 850 })
      await page.emulateMedia({ colorScheme })
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        ),
        true
      )
      await page.screenshot({
        path: path.join(artifactRoot, `production-${width}.png`),
        animations: 'disabled'
      })
    }
    assert.deepEqual(failures, [])
    console.log(
      'Production manifest, Vue rendering and Tailwind styling passed through Sails HTTP.'
    )
  } finally {
    if (browser) await browser.close()
    await new Promise((resolve) => server.lower(resolve))
    await fs.rm(fixture, { recursive: true, force: true })
  }
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
