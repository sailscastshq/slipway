const test = require('node:test')
const assert = require('node:assert/strict')
const config = require('../../api/lib/upgrade-launch-config')
const image = `ghcr.io/sailscastshq/slipway@sha256:${'a'.repeat(64)}`
function fixture() {
  return {
    current: {
      Config: {
        Env: [
          'SESSION_SECRET=synthetic-existing-secret',
          'DATA_ENCRYPTION_KEY=synthetic-existing-key',
          'NODE_ENV=development',
          'SLIPWAY_MIGRATE=alter',
          'PORT=1337'
        ],
        Labels: { caddy: 'fixture.example' },
        ExposedPorts: { '1337/tcp': {} }
      },
      HostConfig: {
        PortBindings: {
          '1337/tcp': [{ HostIp: '127.0.0.1', HostPort: '1337' }]
        },
        Memory: 256 * 1024 * 1024
      },
      Mounts: [
        {
          Type: 'volume',
          Name: 'original-db',
          Source: '/original',
          Destination: '/app/db',
          RW: true
        },
        {
          Type: 'bind',
          Source: '/var/slipway/apps',
          Destination: '/var/slipway/apps',
          RW: true
        }
      ],
      NetworkSettings: { Networks: { slipway: {} } }
    },
    imageConfig: {
      Entrypoint: ['/usr/bin/tini', '--'],
      Cmd: ['npm', 'start'],
      WorkingDir: '/app'
    },
    image,
    stage: {
      directory: '/private/stage',
      dataDirectory: '/private/stage/data'
    },
    marker: '/private/stage/launch.json',
    instanceId: 'fixture-instance',
    manifestHash: 'b'.repeat(64),
    runId: 'fixture-run'
  }
}
test('structured launch preserves existing secrets, ports, app storage and image entrypoint', () => {
  const result = config(fixture())
  assert.ok(result.Env.includes('SESSION_SECRET=synthetic-existing-secret'))
  assert.ok(result.Env.includes('DATA_ENCRYPTION_KEY=synthetic-existing-key'))
  assert.ok(result.Env.includes('SLIPWAY_MIGRATE=safe'))
  assert.ok(!result.Env.includes('SLIPWAY_MIGRATE=alter'))
  assert.deepEqual(result.HostConfig.Mounts[0], {
    Type: 'bind',
    Source: '/private/stage/data',
    Target: '/app/db',
    ReadOnly: false
  })
  assert.equal(result.HostConfig.Mounts[1].Source, '/var/slipway/apps')
  assert.equal(result.HostConfig.RestartPolicy.Name, 'no')
  assert.equal(
    result.HostConfig.PortBindings['1337/tcp'][0].HostIp,
    '127.0.0.1'
  )
  assert.deepEqual(result.Cmd, ['npm', 'start'])
})
test('ambiguous data mounts and network topology fail instead of silently changing deployment', () => {
  const options = fixture()
  options.current.NetworkSettings.Networks.extra = {}
  assert.throws(() => config(options), { code: 'upgradeLaunchConfig' })
  delete options.current.NetworkSettings.Networks.extra
  options.current.Mounts.push({ ...options.current.Mounts[0] })
  assert.throws(() => config(options), { code: 'upgradeLaunchConfig' })
})
test('coordinated launch preserves private state access and replaces stale marker mounts', () => {
  const options = fixture()
  options.stateRoot = '/private'
  options.hostCheckpoint = '/private/host-1/host.json'
  options.current.Name = '/my-slipway'
  options.current.Config.Env.push(
    'SLIPWAY_UPGRADE_MARKER=/private/old-stage/launch.json'
  )
  options.current.Mounts.push(
    { Type: 'bind', Source: '/private', Destination: '/private', RW: true },
    {
      Type: 'bind',
      Source: '/private/old-stage',
      Destination: '/private/old-stage',
      RW: false
    }
  )
  const result = config(options)
  assert.equal(
    result.HostConfig.Mounts.filter((mount) => mount.Target === '/private')
      .length,
    1
  )
  assert.equal(
    result.HostConfig.Mounts.find((mount) => mount.Target === '/private')
      .ReadOnly,
    false
  )
  assert.ok(
    !result.HostConfig.Mounts.some(
      (mount) => mount.Target === '/private/old-stage'
    )
  )
  assert.ok(result.Env.includes('SLIPWAY_UPGRADE_STATE_ROOT=/private'))
  assert.ok(result.Env.includes('SLIPWAY_UPGRADE_CONTAINER=my-slipway'))
  assert.ok(
    result.Env.includes(
      'SLIPWAY_UPGRADE_HOST_CHECKPOINT=/private/host-1/host.json'
    )
  )
  options.hostCheckpoint = '/elsewhere/host.json'
  assert.throws(() => config(options), { code: 'upgradeLaunchConfig' })
})
