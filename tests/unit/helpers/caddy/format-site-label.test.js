const { test } = require('sounding')

test('Caddy site labels follow the configured ingress owner', async ({
  sails,
  expect
}) => {
  const originalIngress = sails.config.custom.slipwayIngress

  try {
    sails.config.custom.slipwayIngress = 'public'
    const publicLabel = await sails.helpers.caddy.formatSiteLabel.with({
      domains: ['slipway.example.com', 'app.example.com']
    })

    sails.config.custom.slipwayIngress = 'cloudflare-tunnel'
    const tunnelLabel = await sails.helpers.caddy.formatSiteLabel.with({
      domains: ['slipway.example.com', 'app.example.com']
    })

    expect(publicLabel).toBe('slipway.example.com,app.example.com')
    expect(tunnelLabel).toBe(
      'http://slipway.example.com,http://app.example.com'
    )
  } finally {
    sails.config.custom.slipwayIngress = originalIngress
  }
})
