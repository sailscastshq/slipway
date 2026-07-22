const { test } = require('sounding')

test('routable apps publish their container port on the public host interface', async ({
  sails,
  expect
}) => {
  const argument = await sails.helpers.docker.formatPortBinding.with({
    host: '0.0.0.0',
    hostPort: 1340,
    containerPort: 1337
  })
  const binding = await sails.helpers.docker.parsePortBindings.with({
    portBindings: {
      '1337/tcp': [
        { HostIp: '0.0.0.0', HostPort: '1340' },
        { HostIp: '::', HostPort: '1340' }
      ]
    },
    containerPort: 1337,
    hostPort: 1340,
    host: '0.0.0.0'
  })

  expect(argument).toBe('1340:1337')
  expect(binding.valid).toBe(true)
  expect(binding.hostPort).toBe(1340)
  expect(binding.diagnostic).toMatch(/0\.0\.0\.0:1340 -> 1337\/tcp/)
})

test('worker ports bind to loopback instead of the public interface', async ({
  sails,
  expect
}) => {
  const argument = await sails.helpers.docker.formatPortBinding.with({
    host: '127.0.0.1',
    hostPort: 1341,
    containerPort: 1337
  })

  expect(argument).toBe('127.0.0.1:1341:1337')
})

test('direct access is advertised only for a verified live Docker mapping', async ({
  sails,
  expect
}) => {
  const directAccess = await sails.helpers.deploy.getDirectAccess.with({
    serverIp: '46.62.235.40',
    hostPort: 1340,
    routePath: '/',
    containerRunning: true,
    portBinding: {
      valid: true,
      host: '0.0.0.0',
      hostPort: 1340,
      containerPort: 1337
    }
  })

  expect(directAccess.status).toBe('published')
  expect(directAccess.url).toBe('http://46.62.235.40:1340')
  expect(directAccess.firewallHint).toMatch(/allow inbound TCP 1340/)
})

test('a missing or incorrect Docker mapping becomes a diagnostic, not a link', async ({
  sails,
  expect
}) => {
  const binding = await sails.helpers.docker.parsePortBindings.with({
    portBindings: {
      '1337/tcp': [{ HostIp: '127.0.0.1', HostPort: '1400' }]
    },
    containerPort: 1337,
    hostPort: 1340,
    host: '0.0.0.0'
  })
  const directAccess = await sails.helpers.deploy.getDirectAccess.with({
    serverIp: '46.62.235.40',
    hostPort: 1340,
    routePath: '/',
    containerRunning: true,
    portBinding: binding
  })

  expect(binding.valid).toBe(false)
  expect(directAccess.status).toBe('unavailable')
  expect(directAccess.url).toBe(null)
  expect(directAccess.attemptedUrl).toBe('http://46.62.235.40:1340')
  expect(directAccess.message).toMatch(/not the expected host port 1340/)
})

test('workers never receive a direct HTTP endpoint', async ({
  sails,
  expect
}) => {
  const directAccess = await sails.helpers.deploy.getDirectAccess.with({
    serverIp: '46.62.235.40',
    hostPort: 1342,
    routePath: null,
    containerRunning: true,
    portBinding: {
      valid: true,
      host: '127.0.0.1',
      hostPort: 1342,
      containerPort: 1337
    }
  })

  expect(directAccess.status).toBe('not-routable')
  expect(directAccess.url).toBe(null)
})

test('an intentionally private loopback binding is explained instead of advertised', async ({
  sails,
  expect
}) => {
  const directAccess = await sails.helpers.deploy.getDirectAccess.with({
    serverIp: '46.62.235.40',
    hostPort: 1343,
    routePath: '/',
    containerRunning: true,
    portBinding: {
      valid: true,
      host: '127.0.0.1',
      hostPort: 1343,
      containerPort: 1337
    }
  })

  expect(directAccess.status).toBe('unavailable')
  expect(directAccess.url).toBe(null)
  expect(directAccess.message).toMatch(/intentionally private/)
})
