const { test } = require('sounding')
const {
  authorizeSocketHandshake,
  buildRealtimeConfig,
  issueRealtimeToken,
  serializeFeedback,
  verifyRealtimeToken
} = require('../../../api/lib/bearing-realtime')

test('Bearing realtime stays on its private integration path for mounted apps', ({
  expect
}) => {
  const req = {
    protocol: 'https',
    get(name) {
      return name === 'host' ? 'product.example.com' : undefined
    }
  }
  const config = buildRealtimeConfig({
    req,
    resolved: {
      space: { id: '42' },
      integrationBasePath: '/academy/_slipway/bearing'
    },
    projectSlug: 'durable-ui',
    environmentSlug: 'production',
    appSlug: 'academy',
    secret: 'test-bearing-realtime-secret'
  })

  expect(config.socketPath).toBe('/academy/_slipway/bearing/socket.io')
})

test('Bearing realtime tokens are short-lived, origin-bound, and tamper-safe', ({
  expect
}) => {
  const secret = 'test-bearing-realtime-secret'
  const origin = 'https://product.example.com'
  const token = issueRealtimeToken({
    spaceId: '42',
    origin,
    secret,
    ttlMs: 60_000
  })

  const payload = verifyRealtimeToken({ token, origin, secret })
  expect(payload.version).toBe(1)
  expect(payload.spaceId).toBe('42')
  expect(payload.origin).toBe(origin)
  expect(
    verifyRealtimeToken({
      token,
      origin: 'https://attacker.example.com',
      secret
    })
  ).toBe(null)
  expect(verifyRealtimeToken({ token: `${token}x`, origin, secret })).toBe(null)
  expect(
    verifyRealtimeToken({
      token: issueRealtimeToken({ spaceId: '42', origin, secret, ttlMs: -1 }),
      origin,
      secret
    })
  ).toBe(null)
})

test('Bearing socket authorization accepts its control plane or a signed app origin', ({
  expect
}) => {
  const secret = 'test-bearing-realtime-secret'
  const controlPlaneOrigin = 'https://slipway.example.com'
  const appOrigin = 'https://product.example.com'
  const token = issueRealtimeToken({
    spaceId: '42',
    origin: appOrigin,
    secret
  })

  expect(
    authorizeSocketHandshake({
      handshake: { headers: { origin: controlPlaneOrigin } },
      controlPlaneOrigin,
      secret
    })
  ).toBe(true)
  expect(
    authorizeSocketHandshake({
      handshake: {
        headers: { origin: appOrigin },
        query: { bearingRealtimeToken: token }
      },
      controlPlaneOrigin,
      secret
    })
  ).toBe(true)
  expect(
    authorizeSocketHandshake({
      handshake: { headers: { origin: 'https://attacker.example.com' } },
      controlPlaneOrigin,
      secret
    })
  ).toBe(false)
})

test('Bearing realtime feedback exposes renderable image metadata without storage internals', ({
  expect
}) => {
  const feedback = serializeFeedback({
    publicId: 'bfd_images',
    title: 'Show the broken state',
    images: [
      {
        url: 'https://assets.slipway.test/bearing/example.png',
        objectPath: 'bearing/private-storage-path/example.png',
        name: 'generated-name.png',
        size: 2048,
        type: 'image/png'
      }
    ],
    category: 'bug',
    status: 'reviewing',
    voteCount: 0,
    submittedAnonymously: true
  })

  expect(feedback.images).toEqual([
    {
      url: 'https://assets.slipway.test/bearing/example.png',
      size: 2048,
      type: 'image/png'
    }
  ])
  expect(feedback.images[0].objectPath).toBe(undefined)
})
