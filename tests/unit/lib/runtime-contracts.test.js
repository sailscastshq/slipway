const { test } = require('sounding')

const dashboard = {
  completions: require('../../../api/lib/contracts/helm-completion-metadata'),
  fingerprint: require('../../../api/lib/contracts/helm-config-fingerprint'),
  wake: require('../../../api/lib/contracts/wake-contract'),
  value: require('../../../api/lib/contracts/wake-value-contract')
}
const hook = {
  completions: require('../../../packages/hook/lib/helm-completion-metadata'),
  fingerprint: require('../../../packages/hook/lib/helm-config-fingerprint'),
  wake: require('../../../packages/hook/lib/wake-contract'),
  value: require('../../../packages/hook/lib/wake-value-contract')
}

test('dashboard and hook agree on Helm runtime metadata', ({ expect }) => {
  const app = {
    config: {
      environment: 'production',
      datastores: {
        default: { adapter: 'sails-sqlite', url: 'sqlite:///app/db' }
      },
      models: { datastore: 'default' },
      custom: { publicName: 'App', secret: 'do-not-return' }
    },
    models: {
      user: {
        identity: 'user',
        globalId: 'User',
        attributes: { email: { type: 'string' } }
      }
    },
    helpers: { billing: { reconcile() {} } }
  }

  expect(dashboard.completions(app)).toEqual(hook.completions(app))
  expect(dashboard.fingerprint(app)).toBe(hook.fingerprint(app))
})

test('dashboard and hook agree on Wake settings and event values', ({
  expect
}) => {
  const settings = {
    allowedOrigins: ['https://example.com', 'https://example.com'],
    excludedPaths: ['/admin/*'],
    requireConsent: true
  }
  const dimensions = {
    referrer: 'https://example.org/article?secret=1',
    campaign: { utm_source: 'newsletter' },
    device: 'mobile'
  }
  const now = Date.UTC(2026, 8, 28)
  const payment = {
    transactionId: 'order-123',
    amount: 4200,
    currency: 'USD',
    occurredAt: now
  }

  expect(dashboard.wake.settings(settings)).toEqual(
    hook.wake.settings(settings)
  )
  expect(dashboard.wake.dimensions(dimensions)).toEqual(
    hook.wake.dimensions(dimensions)
  )
  expect(dashboard.value.properties({ plan: 'pro' })).toEqual(
    hook.value.properties({ plan: 'pro' })
  )
  expect(dashboard.value.payment(payment, now)).toEqual(
    hook.value.payment(payment, now)
  )
})
