const childProcess = require('node:child_process')
const path = require('node:path')

const { test } = require('sounding')

const helperPath = path.resolve(
  __dirname,
  '../../../../api/helpers/caddy/update-dashboard-route.js'
)

test('dashboard route replaces bootstrap access and keeps Tunnel TLS at the edge', async ({
  sails,
  expect
}) => {
  const calls = []
  const originalExecFile = childProcess.execFile
  const originalIngress = sails.config.custom.slipwayIngress
  const originalGetSetting = sails.helpers.setting.get

  childProcess.execFile = (dockerPath, args, callback) => {
    calls.push({ dockerPath, args })
    callback(null, '', '')
  }
  sails.config.custom.slipwayIngress = 'cloudflare-tunnel'
  sails.helpers.setting.get = async () => 'ops@example.com'
  delete require.cache[require.resolve(helperPath)]

  try {
    const helper = require(helperPath)
    const result = await helper.fn({ domain: 'slipway.example.com' })
    const commands = calls.map(({ args }) => args)
    const createCommand = commands.find((args) => args[0] === 'run')

    expect(result.action).toBe('created')
    expect(createCommand.includes('caddy=http://slipway.example.com')).toBe(
      true
    )
    expect(createCommand.some((value) => value.startsWith('caddy.tls='))).toBe(
      false
    )
    expect(commands.at(-1)).toEqual(['rm', '-f', 'slipway-route-bootstrap'])
  } finally {
    childProcess.execFile = originalExecFile
    sails.config.custom.slipwayIngress = originalIngress
    sails.helpers.setting.get = originalGetSetting
    delete require.cache[require.resolve(helperPath)]
  }
})
