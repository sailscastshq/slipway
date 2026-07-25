const path = require('node:path')

const { test } = require('sounding')

const productionConfigPath = path.resolve(
  __dirname,
  '../../../config/env/production.js'
)

test('production custom config keeps the public URL and domain settings together', ({
  expect
}) => {
  const originalSlipwayUrl = process.env.SLIPWAY_URL
  process.env.SLIPWAY_URL = 'https://slipway.example.com'
  delete require.cache[productionConfigPath]

  try {
    const productionConfig = require(productionConfigPath)

    expect(productionConfig.custom.baseUrl).toBe('https://slipway.example.com')
    expect(productionConfig.custom.slipwayDomain).toBe(null)
  } finally {
    delete require.cache[productionConfigPath]
    if (originalSlipwayUrl === undefined) {
      delete process.env.SLIPWAY_URL
    } else {
      process.env.SLIPWAY_URL = originalSlipwayUrl
    }
  }
})
