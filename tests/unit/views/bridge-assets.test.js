const fs = require('node:fs')
const path = require('node:path')
const ejs = require('ejs')
const { test } = require('sounding')

const template = fs.readFileSync(
  path.resolve(__dirname, '../../../views/app.ejs'),
  'utf8'
)

test('host-origin Bridge loads every Slipway asset through its public prefix', ({
  expect
}) => {
  const html = ejs.render(template, {
    page: {
      component: 'projects/bridge',
      props: {
        hostBridgeAssetBasePath: '/academy/bridge/_assets'
      }
    },
    shipwright: {
      styles: () => '<link rel="stylesheet" href="/css/app.css">',
      scripts: () => '<script src="/js/app.js"></script>'
    }
  })

  expect(html).toContain(
    'window.__SLIPWAY_ASSET_PREFIX__ = "/academy/bridge/_assets"'
  )
  expect(html).toContain('href="/academy/bridge/_assets/images/favicon.svg"')
  expect(html).toContain('href="/academy/bridge/_assets/css/app.css"')
  expect(html).toContain('src="/academy/bridge/_assets/js/app.js"')
})

test('direct Slipway pages retain their ordinary asset paths', ({ expect }) => {
  const html = ejs.render(template, {
    page: { component: 'projects/bridge', props: {} },
    shipwright: {
      styles: () => '<link rel="stylesheet" href="/css/app.css">',
      scripts: () => '<script src="/js/app.js"></script>'
    }
  })

  expect(html).toContain('href="/images/favicon.svg"')
  expect(html).toContain('href="/css/app.css"')
  expect(html).toContain('src="/js/app.js"')
  expect(html.includes('__SLIPWAY_ASSET_PREFIX__')).toBe(false)
})
