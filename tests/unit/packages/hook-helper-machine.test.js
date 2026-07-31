const fs = require('fs')
const os = require('os')
const path = require('path')
const { Sails } = require('sails')
const { test } = require('sounding')

const hookPath = path.resolve(__dirname, '../../../packages/hook')

test('Sails furnishes the release flag helper as a genuine helper machine', async ({
  expect
}) => {
  const appPath = createTestApp()
  let app

  try {
    app = await liftTestApp(appPath)

    expect(typeof app.helpers.flags.enabled).toBe('function')
    expect(typeof app.helpers.flags.enabled.with).toBe('function')

    const req = {}
    const enabled = await app.helpers.flags.enabled.with({
      key: 'new-checkout',
      req,
      defaultValue: true
    })

    expect(enabled).toBe(true)
    expect(req._slipwayFlagEvaluations['new-checkout'].value).toBe(true)
    expect(req._slipwayFlagEvaluations['new-checkout'].reason).toBe('default')

    let validationError
    try {
      await app.helpers.flags.enabled.with({ defaultValue: true })
    } catch (error) {
      validationError = error
    }

    expect(Boolean(validationError)).toBe(true)
    expect(validationError.message).toContain('key')
  } finally {
    await lowerTestApp(app)
    fs.rmSync(appPath, { recursive: true, force: true })
  }
})

test('the hook preserves an app-owned flags.enabled helper', async ({
  expect
}) => {
  const appPath = createTestApp({ appOwnedHelper: true })
  let app

  try {
    app = await liftTestApp(appPath)

    const enabled = await app.helpers.flags.enabled.with({
      key: 'new-checkout',
      defaultValue: true
    })

    expect(enabled).toBe(false)
  } finally {
    await lowerTestApp(app)
    fs.rmSync(appPath, { recursive: true, force: true })
  }
})

function createTestApp({ appOwnedHelper = false } = {}) {
  const appPath = fs.mkdtempSync(
    path.join(os.tmpdir(), 'sails-hook-slipway-helper-')
  )
  const nodeModulesPath = path.join(appPath, 'node_modules')
  fs.mkdirSync(nodeModulesPath)
  fs.writeFileSync(
    path.join(appPath, 'package.json'),
    JSON.stringify({
      name: 'sails-hook-slipway-test-app',
      private: true,
      dependencies: {
        'sails-hook-slipway': '0.0.4'
      }
    })
  )
  fs.symlinkSync(hookPath, path.join(nodeModulesPath, 'sails-hook-slipway'))

  if (appOwnedHelper) {
    const helperPath = path.join(appPath, 'api/helpers/flags')
    fs.mkdirSync(helperPath, { recursive: true })
    fs.writeFileSync(
      path.join(helperPath, 'enabled.js'),
      `module.exports = {
  friendlyName: 'App-owned release flag',
  sync: true,
  inputs: {
    key: { type: 'string', required: true },
    defaultValue: { type: 'boolean', defaultsTo: false }
  },
  exits: {
    success: { outputType: 'boolean' }
  },
  fn: function () {
    return false
  }
}
`
    )
  }

  return appPath
}

function liftTestApp(appPath) {
  return new Promise((resolve, reject) => {
    const app = new Sails()
    app.lift(
      {
        appPath,
        port: 0,
        environment: 'test',
        globals: false,
        log: { level: 'silent' },
        hooks: {
          blueprints: false,
          grunt: false,
          i18n: false,
          orm: false,
          policies: false,
          pubsub: false,
          security: false,
          session: false,
          sockets: false,
          views: false
        },
        slipway: {
          bridge: { enabled: false },
          flags: { enabled: false },
          lookout: { enabled: false }
        }
      },
      (error) => (error ? reject(error) : resolve(app))
    )
  })
}

function lowerTestApp(app) {
  if (!app) return Promise.resolve()
  return new Promise((resolve) => app.lower(resolve))
}
