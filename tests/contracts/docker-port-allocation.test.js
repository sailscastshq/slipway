const { test } = require('sounding')
const assert = require('node:assert/strict')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { randomUUID } = require('node:crypto')
const path = require('node:path')
const run = promisify(execFile)

test('containerized allocation skips a Docker-host binding missing from app records and publishes the selected port', async ({
  expect
}) => {
  const image = process.env.SLIPWAY_PORT_PROOF_IMAGE || 'slipway:port-proof'
  const scope = randomUUID()
  const names = ['occupied', 'allocator', 'selected'].map(
    (role) => `slipway-port-proof-${role}-${scope}`
  )
  const owned = []
  const command = (args) =>
    run('docker', args, { timeout: 30000, maxBuffer: 1024 * 1024 })
  const start = async (name, args) => {
    // create separately so a start failure still has an owned cleanup target.
    await command([
      'create',
      '--name',
      name,
      '--label',
      `slipway.port-proof=${scope}`,
      ...args
    ])
    owned.push(name)
    await command(['start', name])
  }
  const serve = [
    image,
    'node',
    '-e',
    'require("http").createServer((req,res)=>res.end("ok")).listen(8080,"0.0.0.0")'
  ]
  try {
    await command(['image', 'inspect', image])
    await start(names[0], ['-p', '127.0.0.1::8080', ...serve])
    const { stdout: bindings } = await command([
      'inspect',
      '--format',
      '{{json .NetworkSettings.Ports}}',
      names[0]
    ])
    const occupied = Number(JSON.parse(bindings)['8080/tcp'][0].HostPort)
    await start(names[1], [
      '--network',
      'none',
      '-v',
      '/var/run/docker.sock:/var/run/docker.sock',
      '-v',
      `${path.resolve('.')}:/proof:ro`,
      image,
      'node',
      '/proof/tests/fixtures/docker-port-allocation/allocate.cjs',
      String(occupied)
    ])
    const { stdout: exit } = await command(['wait', names[1]])
    const { stdout: logs, stderr } = await command(['logs', names[1]])
    assert.equal(
      exit.trim(),
      '0',
      `Allocator fixture failed: ${logs} ${stderr}`
    )
    const result = JSON.parse(logs.trim())
    expect(result.localProbeWouldSelect).toBe(occupied)
    expect(result.selected === occupied).toBe(false)
    await start(names[2], ['-p', `127.0.0.1:${result.selected}:8080`, ...serve])
    const { stdout: selected } = await command([
      'inspect',
      '--format',
      '{{json .NetworkSettings.Ports}}',
      names[2]
    ])
    expect(Number(JSON.parse(selected)['8080/tcp'][0].HostPort)).toBe(
      result.selected
    )
    console.log(`Docker namespace proof: ${JSON.stringify(result)}`)
  } finally {
    for (const name of owned.reverse()) {
      const { stdout } = await command([
        'inspect',
        '--format',
        '{{index .Config.Labels "slipway.port-proof"}}',
        name
      ])
      if (stdout.trim() !== scope) throw new Error('Fixture ownership changed')
      await command(['rm', '-f', name])
    }
  }
})
