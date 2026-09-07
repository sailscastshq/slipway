const childProcess = require('node:child_process')
const { promisify } = require('node:util')
const path = require('node:path')
const { test } = require('sounding')
const helperPath = path.resolve(
  __dirname,
  '../../../../api/helpers/caddy/update-dashboard-route.js'
)

for (const failVerification of [false, true])
  test(`dashboard route preserves its predecessor until verification (${
    failVerification ? 'failure' : 'success'
  })`, async ({ sails, expect }) => {
    const calls = []
    const originals = {
      exec: childProcess.execFile,
      verify: sails.helpers.caddy.verifyRoute,
      finish: sails.helpers.caddy.finishRouteUpdate,
      get: sails.helpers.setting.get,
      ingress: sails.config.custom.slipwayIngress
    }
    const stub = () => {}
    stub[promisify.custom] = async (_docker, args) => {
      calls.push(args)
      if (args[0] === 'inspect') {
        if (failVerification) return { stdout: 'true', stderr: '' }
        throw new Error('No such container')
      }
      return { stdout: '', stderr: '' }
    }
    childProcess.execFile = stub
    sails.config.custom.slipwayIngress = 'cloudflare-tunnel'
    sails.helpers.setting.get = async (key) =>
      key === 'instanceDomain' ? 'old.example.com' : 'ops@example.com'
    sails.helpers.caddy.verifyRoute = {
      with: async (options) => {
        expect(options.expectedDomains).toEqual(['new.example.com'])
        expect(
          calls.some(
            (args) =>
              args[0] === 'rm' && args.includes('slipway-route-dashboard')
          )
        ).toBe(false)
        if (failVerification) throw new Error('Caddy rejected candidate')
      }
    }
    sails.helpers.caddy.finishRouteUpdate = {
      with: async () => calls.push(['commit'])
    }
    delete require.cache[require.resolve(helperPath)]
    try {
      let error
      let result
      try {
        result = await require(helperPath).fn({ domain: 'new.example.com' })
      } catch (caught) {
        error = caught
      }
      if (failVerification) {
        expect(error.message).toBe('Caddy rejected candidate')
        expect(calls.some((args) => args[0] === 'commit')).toBe(false)
        expect(
          calls.some(
            (args) =>
              args[0] === 'rm' && args.includes('slipway-route-dashboard')
          )
        ).toBe(false)
      } else {
        expect(result.action).toBe('created')
        const run = calls.find((args) => args[0] === 'run')
        expect(run.includes('caddy=http://new.example.com')).toBe(true)
        expect(run.some((arg) => arg.startsWith('caddy.tls='))).toBe(false)
        expect(calls.at(-1)).toEqual(['rm', '-f', 'slipway-route-bootstrap'])
      }
    } finally {
      childProcess.execFile = originals.exec
      sails.helpers.caddy.verifyRoute = originals.verify
      sails.helpers.caddy.finishRouteUpdate = originals.finish
      sails.helpers.setting.get = originals.get
      sails.config.custom.slipwayIngress = originals.ingress
      delete require.cache[require.resolve(helperPath)]
    }
  })
