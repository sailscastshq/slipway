const http = require('node:http')
const { test } = require('sounding')
const defineSlipwayHook = require('../../../packages/hook')

test('host Bridge sends signed-in verified identity through the app credential', async ({
  expect
}) => {
  const exchange = await startExchangeServer()
  const { route } = await createBridgeRoute({
    bridge: {
      enabled: true,
      exchangeUrl: exchange.url,
      appId: '42',
      secret: 'slb_app-secret',
      loginPath: '/login',
      identity: defaultIdentityConfig()
    },
    user: {
      id: 'host-user-7',
      email: 'EDITOR@EXAMPLE.COM',
      fullName: 'Host Editor',
      emailStatus: 'verified'
    }
  })
  const response = createResponse()

  try {
    await route(
      {
        session: { userId: 'host-user-7' },
        originalUrl: '/bridge?invite=bli_invitation',
        query: { invite: 'bli_invitation' }
      },
      response
    )

    expect(response.status).toBe('redirect')
    expect(response.value).toBe(
      'https://slipway.example/bridge/launch?code=blc_once'
    )
    expect(exchange.request.authorization).toBe('Bearer slb_app-secret')
    expect(exchange.request.body.appId).toBe('42')
    expect(exchange.request.body.inviteToken).toBe('bli_invitation')
    expect(exchange.request.body.hostUser).toEqual({
      id: 'host-user-7',
      email: 'editor@example.com',
      fullName: 'Host Editor',
      emailVerified: true
    })
  } finally {
    await exchange.close()
  }
})

test('host Bridge preserves the invitation while sending a guest through app login', async ({
  expect
}) => {
  const { route } = await createBridgeRoute({
    bridge: {
      enabled: true,
      exchangeUrl: 'http://127.0.0.1:1/exchange',
      appId: '42',
      secret: 'slb_app-secret',
      loginPath: '/sign-in',
      identity: defaultIdentityConfig()
    }
  })
  const response = createResponse()

  await route(
    {
      session: {},
      originalUrl: '/bridge?invite=bli_invitation',
      query: { invite: 'bli_invitation' }
    },
    response
  )

  expect(response.status).toBe('redirect')
  expect(response.value).toBe(
    '/sign-in?redirect=%2Fbridge%3Finvite%3Dbli_invitation'
  )
})

test('proxied Bridge exchanges on the host origin with its routed app prefix', async ({
  expect
}) => {
  const exchange = await startExchangeServer()
  const { hostRoute } = await createBridgeRoute({
    bridge: {
      enabled: true,
      exchangeUrl: exchange.url,
      appId: '42',
      secret: 'slb_app-secret',
      loginPath: '/sign-in',
      routePath: '/academy',
      identity: defaultIdentityConfig()
    },
    user: {
      id: 'host-user-7',
      email: 'editor@example.com',
      fullName: 'Host Editor',
      emailStatus: 'verified'
    }
  })
  const response = createResponse()

  try {
    await hostRoute(
      {
        session: { userId: 'host-user-7' },
        originalUrl: '/_slipway/bridge',
        query: {}
      },
      response
    )

    expect(response.status).toBe('redirect')
    expect(exchange.request.body.hostOrigin).toBe(true)
  } finally {
    await exchange.close()
  }
})

test('proxied Bridge prefixes host login and preserves its invitation callback', async ({
  expect
}) => {
  const { hostRoute } = await createBridgeRoute({
    bridge: {
      enabled: true,
      exchangeUrl: 'http://127.0.0.1:1/exchange',
      appId: '42',
      secret: 'slb_app-secret',
      loginPath: '/sign-in',
      routePath: '/academy',
      identity: defaultIdentityConfig()
    }
  })
  const response = createResponse()

  await hostRoute(
    {
      session: {},
      originalUrl: '/_slipway/bridge?invite=bli_invitation',
      query: { invite: 'bli_invitation' }
    },
    response
  )

  expect(response.status).toBe('redirect')
  expect(response.value).toBe(
    '/academy/sign-in?redirect=%2Facademy%2F_slipway%2Fbridge%3Finvite%3Dbli_invitation'
  )
})

test('host Bridge fails closed when the app cannot prove email verification', async ({
  expect
}) => {
  const { route } = await createBridgeRoute({
    bridge: {
      enabled: true,
      exchangeUrl: 'http://127.0.0.1:1/exchange',
      appId: '42',
      secret: 'slb_app-secret',
      loginPath: '/login',
      identity: defaultIdentityConfig()
    },
    user: {
      id: 'host-user-7',
      email: 'editor@example.com',
      fullName: 'Host Editor'
    },
    userAttributes: {
      id: {},
      email: {},
      fullName: {}
    }
  })
  const response = createResponse()

  await route(
    {
      session: { userId: 'host-user-7' },
      originalUrl: '/bridge',
      query: {}
    },
    response
  )

  expect(response.status).toBe('send')
  expect(response.statusCode).toBe(403)
  expect(response.contentType).toBe('html')
  expect(response.value).toContain('Bridge access unavailable')
  expect(response.value).toContain('aria-label="Slipway Bridge"')
  expect(response.value).toContain(
    'Your sign-in may have expired, or this account may not have access.'
  )
  expect(response.value).toContain('contact your administrator')
  expect(response.value).toContain('403 · BRIDGE_ACCESS_DENIED')
  expect(response.value.includes('host-app')).toBe(false)

  const jsonResponse = createResponse()
  await route(
    {
      session: { userId: 'host-user-7' },
      originalUrl: '/bridge',
      query: {},
      wantsJSON: true,
      headers: { accept: 'application/json' }
    },
    jsonResponse
  )
  expect(jsonResponse.status).toBe('json')
  expect(jsonResponse.statusCode).toBe(403)
  expect(jsonResponse.value).toEqual({
    error: 'Forbidden',
    code: 'bridge_access_denied',
    message:
      'We couldn’t open Bridge. Your sign-in may have expired, or this account may not have access.'
  })
})

test('host Bridge explains an uninvited identity without exposing raw Forbidden', async ({
  expect
}) => {
  const exchange = await startExchangeServer({ statusCode: 403 })
  const { hostRoute } = await createBridgeRoute({
    bridge: {
      enabled: true,
      exchangeUrl: exchange.url,
      appId: '42',
      secret: 'slb_app-secret',
      loginPath: '/login',
      routePath: '/academy',
      identity: defaultIdentityConfig()
    },
    user: {
      id: 'host-user-7',
      email: 'editor@example.com',
      fullName: 'Host Editor',
      emailStatus: 'verified'
    }
  })
  const response = createResponse()

  try {
    await hostRoute(
      {
        session: { userId: 'host-user-7' },
        originalUrl: '/_slipway/bridge',
        query: {}
      },
      response
    )

    expect(response.status).toBe('send')
    expect(response.statusCode).toBe(403)
    expect(response.value).toContain(
      'Your sign-in may have expired, or this account may not have access.'
    )
    expect(response.value.includes('editor@example.com')).toBe(false)
    expect(response.value.includes('invited')).toBe(false)
    expect(response.value).toContain('href="/academy/_slipway/bridge"')
    expect(response.value).toContain('href="/academy/"')
    expect(response.value).toContain('Try again')
    expect(response.value).toContain('Return to app')
  } finally {
    await exchange.close()
  }
})

async function createBridgeRoute({
  bridge,
  user = null,
  userAttributes = {
    id: {},
    email: {},
    fullName: {},
    emailStatus: {}
  }
}) {
  const sails = {
    config: {
      slipway: {
        bridge,
        lookout: {
          enabled: true
        }
      }
    },
    hooks: {
      helpers: {
        furnishHelper: () => {}
      }
    },
    log: {
      verbose: () => {},
      info: () => {},
      warn: () => {}
    },
    models: {
      user: {
        attributes: userAttributes,
        findOne: async ({ id }) =>
          user && String(user.id) === String(id) ? user : null
      }
    },
    helpers: {},
    after: (event, callback) => {
      if (event === 'hook:helpers:loaded') callback()
    },
    on: () => {}
  }
  const hook = defineSlipwayHook(sails)

  await new Promise((resolve, reject) => {
    hook.initialize((error) => (error ? reject(error) : resolve()))
  })

  return {
    route: hook.routes.after['GET /bridge'],
    hostRoute: hook.routes.after['GET /_slipway/bridge']
  }
}

function createResponse() {
  return {
    status: null,
    statusCode: 200,
    contentType: null,
    value: null,
    redirect(value) {
      this.status = 'redirect'
      this.value = value
      return value
    },
    forbidden(value) {
      this.status = 'forbidden'
      this.value = value
      return value
    },
    type(value) {
      this.contentType = value
      return this
    },
    send(value) {
      this.status = 'send'
      this.value = value
      return value
    },
    json(value) {
      this.status = 'json'
      this.value = value
      return value
    },
    notFound(value) {
      this.status = 'notFound'
      this.value = value
      return value
    },
    serverError(value) {
      this.status = 'serverError'
      this.value = value
      return value
    }
  }
}

function defaultIdentityConfig() {
  return {
    model: 'user',
    sessionKey: 'userId',
    emailAttribute: 'email',
    nameAttribute: 'fullName',
    emailStatusAttribute: 'emailStatus',
    emailVerifiedAttribute: 'emailVerified',
    verifiedEmailStatuses: ['verified', 'confirmed']
  }
}

function startExchangeServer({ statusCode = 201 } = {}) {
  return new Promise((resolve, reject) => {
    const request = {}
    const server = http.createServer((incoming, response) => {
      const chunks = []
      incoming.on('data', (chunk) => chunks.push(chunk))
      incoming.on('end', () => {
        request.authorization = incoming.headers.authorization
        request.body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        response.writeHead(statusCode, { 'content-type': 'application/json' })
        response.end(
          JSON.stringify(
            statusCode === 201
              ? {
                  launchUrl:
                    'https://slipway.example/bridge/launch?code=blc_once'
                }
              : { error: 'Forbidden' }
          )
        )
      })
    })
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve({
        url: `http://127.0.0.1:${address.port}/exchange`,
        request,
        close: () =>
          new Promise((done, fail) =>
            server.close((error) => (error ? fail(error) : done()))
          )
      })
    })
  })
}
