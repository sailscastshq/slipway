const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const ejs = require('ejs')
const { chromium } = require('playwright')
const { resourceAlertMessage } = require('../api/lib/resource-alert-message')
async function main() {
  const destination = path.resolve(process.argv[2] || 'docs/images')
  fs.mkdirSync(destination, { recursive: true })
  const fixture = {
    containerName: 'slipway-sailsconf-production-sailsconf-com-628',
    targetLabel: 'sailsconf/production',
    cpuPercent: 0.01,
    memoryPercent: 90.6,
    memoryUsage: 464 * 1048576,
    memoryLimit: 512 * 1048576,
    cpuHigh: false,
    memHigh: true,
    observedAt: Date.parse('2026-10-04T00:00:00Z'),
    instanceName: 'Slipway',
    lookoutUrl:
      'https://example.invalid/projects/sailsconf/environments/production/lookout?container=slipway-sailsconf-production-sailsconf-com-628'
  }
  const before = execFileSync(
    'git',
    [
      'show',
      '0fb573776551106a91a4d0f67f6a2be3712d5513:views/emails/resource-alert.ejs'
    ],
    { encoding: 'utf8' }
  )
  const after = fs.readFileSync('views/emails/resource-alert.ejs', 'utf8')
  const layout = fs.readFileSync('views/layouts/mail.ejs', 'utf8')
  const data = resourceAlertMessage(fixture)
  const browser = await chromium.launch({ headless: true })
  try {
    for (const [name, template, subject] of [
      ['before', before, '⚠️ Things are heating up — ' + fixture.containerName],
      ['after', after, data.subject]
    ]) {
      const body = ejs.render(template, data)
      const html =
        '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div style="padding:16px;font:14px system-ui;background:#fff;overflow-wrap:anywhere">Subject: ' +
        ejs.escapeXML(subject) +
        '</div>' +
        ejs.render(layout, { body }) +
        '</body></html>'
      const page = await browser.newPage({
        viewport: { width: 680, height: 900 },
        deviceScaleFactor: 1
      })
      await page.setContent(html)
      await page.screenshot({
        path: path.join(destination, 'resource-alert-' + name + '.png'),
        fullPage: true
      })
      await page.setViewportSize({ width: 390, height: 844 })
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth
      )
      if (overflow) throw new Error(name + ' email overflows mobile width')
      if (name === 'after')
        await page.screenshot({
          path: path.join(destination, 'resource-alert-after-mobile.png'),
          fullPage: true
        })
      await page.close()
    }
  } finally {
    await browser.close()
  }
  console.log(
    'Rendered before/after email examples; mobile width verified. No mail sent.'
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
