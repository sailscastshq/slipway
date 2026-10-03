const { test } = require('sounding')
const assert = require('node:assert/strict')
const helper = require('../../../../api/helpers/caddy/format-site-label')

test('Caddy site labels separate multiple hostnames with comma and whitespace', async () => {
  const original = global.sails
  try {
    for (const ingress of ['cloudflare-tunnel', 'caddy']) {
      global.sails = { config: { custom: { slipwayIngress: ingress } } }
      const prefix = ingress === 'cloudflare-tunnel' ? 'http://' : ''
      assert.equal(
        await helper.fn({
          domains: [' atlas.example.test ', 'atlas-production.localhost', '']
        }),
        `${prefix}atlas.example.test, ${prefix}atlas-production.localhost`
      )
      assert.equal(
        await helper.fn({ domains: ['atlas.example.test'] }),
        `${prefix}atlas.example.test`
      )
    }
  } finally {
    global.sails = original
  }
})
