const { test } = require('node:test')
const assert = require('node:assert/strict')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { randomUUID } = require('node:crypto')
const names = require('../../api/lib/app-container-name')
const command = promisify(execFile)

// No image pulls, host ports, mounts, production networks or global cleanup.
// CI prepares this image; local runs require an existing node:22-slim image.
test('generated app names resolve and serve health over real Docker DNS', async () => {
  const image = 'node:22-slim'
  const scope = randomUUID()
  const label = `io.slipway.test.deployment-dns=${scope}`
  const network = `slipway-dns-${scope}`
  const owned = []
  const docker = (args) =>
    command('docker', args, {
      timeout: 30000,
      maxBuffer: 1024 * 1024
    })
  const { stdout: inspected } = await docker(['image', 'inspect', image])
  const imageId = JSON.parse(inspected)[0].Id
  const { stdout: networkId } = await docker([
    'network',
    'create',
    '--internal',
    '--label',
    label,
    network
  ])
  const cases = [63, 64, 69].map((length) => {
    const suffix = '-production-studio-1053'
    const project =
      scope.slice(0, 8) +
      'p'.repeat(length - 'slipway-'.length - suffix.length - 8)
    assert.equal(
      names.legacyName(project, 'production', 'studio', 1053).length,
      length
    )
    return names.generateName(project, 'production', 'studio', 1053)
  })
  cases.push(
    names.generateName(
      scope + '-studio'.repeat(10),
      'production',
      'studio',
      1054
    )
  )
  try {
    for (const name of cases) {
      assert.ok(name.length <= 63)
      const { stdout } = await docker([
        'run',
        '-d',
        '--pull',
        'never',
        '--network',
        network,
        '--name',
        name,
        '--label',
        label,
        imageId,
        'node',
        '-e',
        "require('http').createServer((req, res) => { res.writeHead(req.url === '/health' ? 200 : 404); res.end('healthy') }).listen(1337, '0.0.0.0')"
      ])
      owned.push(stdout.trim())
    }
    const probe = `
      const dns = require('node:dns/promises')
      const http = require('node:http')
      const assert = require('node:assert/strict')
      const get = (hostname) => new Promise((resolve, reject) => {
        const req = http.get({ hostname, port: 1337, path: '/health', timeout: 2000 }, (res) => {
          res.resume(); resolve(res.statusCode)
        })
        req.on('error', reject)
        req.on('timeout', () => req.destroy(new Error('timeout')))
      })
      ;(async () => {
        for (const hostname of process.argv.slice(1)) {
          const address = await dns.lookup(hostname)
          assert.ok(address.address)
          let status
          for (let attempt = 0; attempt < 30; attempt++) {
            try { status = await get(hostname); break } catch (error) {
              if (attempt === 29) throw error
              await new Promise((resolve) => setTimeout(resolve, 100))
            }
          }
          assert.equal(status, 200)
          console.log(JSON.stringify({ hostname, length: hostname.length, status }))
        }
      })().catch((error) => { console.error(error); process.exit(1) })
    `
    // A separate container exercises Docker DNS rather than loopback or a
    // host-port fallback. Keep it owned even if its probe exits unsuccessfully.
    const { stdout: client } = await docker([
      'create',
      '--pull',
      'never',
      '--network',
      network,
      '--label',
      label,
      imageId,
      'node',
      '-e',
      probe,
      ...cases
    ])
    owned.push(client.trim())
    const { stdout } = await docker(['start', '-a', client.trim()])
    const { stdout: exitCode } = await docker([
      'inspect',
      '--format',
      '{{.State.ExitCode}}',
      client.trim()
    ])
    assert.equal(exitCode.trim(), '0', stdout)
    const responses = stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    assert.deepEqual(
      responses.map((row) => row.hostname),
      cases
    )
    assert.ok(responses.every((row) => row.status === 200 && row.length <= 63))
  } finally {
    // A create/run may succeed in Docker before the CLI times out. Discover
    // only this invocation's label so partial outcomes are cleaned up too.
    const { stdout: discovered } = await docker([
      'ps',
      '-aq',
      '--filter',
      `label=${label}`
    ])
    const cleanup = new Set([
      ...owned.reverse(),
      ...discovered.trim().split('\n').filter(Boolean)
    ])
    for (const id of cleanup) {
      const { stdout } = await docker([
        'inspect',
        '--format',
        '{{index .Config.Labels "io.slipway.test.deployment-dns"}}',
        id
      ])
      assert.equal(stdout.trim(), scope, 'Fixture ownership changed')
      await docker(['rm', '-f', id])
    }
    const { stdout } = await docker([
      'network',
      'inspect',
      '--format',
      '{{index .Labels "io.slipway.test.deployment-dns"}}',
      networkId.trim()
    ])
    assert.equal(stdout.trim(), scope, 'Fixture network ownership changed')
    await docker(['network', 'rm', networkId.trim()])
  }
})
