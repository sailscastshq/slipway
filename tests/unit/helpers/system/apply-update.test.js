const vm = require('node:vm')

const { test } = require('sounding')

test('self-update docker args include the persistent apps mount when it is missing', async ({
  sails,
  expect
}) => {
  const containerInfo = {
    Mounts: [
      {
        Type: 'volume',
        Name: 'slipway-db',
        Destination: '/app/db'
      }
    ],
    NetworkSettings: {
      Networks: {
        slipway: {}
      }
    },
    HostConfig: {
      PortBindings: {
        '1337/tcp': [{ HostPort: '1337' }]
      }
    },
    Config: {
      Env: ['NODE_ENV=production'],
      Labels: {}
    }
  }

  const { runArgs } = await sails.helpers.system.buildUpdateDockerArgs.with({
    containerInfo,
    extraMounts: [
      {
        type: 'bind',
        source: '/var/slipway/apps',
        destination: '/var/slipway/apps'
      }
    ]
  })

  expect(runArgs.includes('--network')).toBe(true)
  expect(runArgs.includes('slipway')).toBe(true)
  expect(runArgs.includes('-v')).toBe(true)
  expect(runArgs.includes('/app/db')).toBe(false)
  expect(runArgs.includes('slipway-db:/app/db')).toBe(true)
  expect(runArgs.includes('/var/slipway/apps:/var/slipway/apps')).toBe(true)
  expect(runArgs.includes('-p')).toBe(true)
  expect(runArgs.includes('1337:1337')).toBe(true)
})

test('self-update docker args keep an existing apps mount without duplicating it', async ({
  sails,
  expect
}) => {
  const containerInfo = {
    Mounts: [
      {
        Type: 'bind',
        Source: '/var/slipway/apps',
        Destination: '/var/slipway/apps',
        RW: true
      }
    ],
    NetworkSettings: {
      Networks: {}
    },
    HostConfig: {
      PortBindings: {}
    },
    Config: {
      Env: [],
      Labels: {}
    }
  }

  const { runArgs } = await sails.helpers.system.buildUpdateDockerArgs.with({
    containerInfo,
    extraMounts: [
      {
        type: 'bind',
        source: '/var/slipway/apps',
        destination: '/var/slipway/apps'
      }
    ]
  })

  expect(
    runArgs.filter((value) => value === '/var/slipway/apps:/var/slipway/apps')
      .length
  ).toBe(1)
})

test('self-update preserves loopback-only dashboard port bindings', async ({
  sails,
  expect
}) => {
  const { runArgs } = await sails.helpers.system.buildUpdateDockerArgs.with({
    containerInfo: {
      Mounts: [],
      NetworkSettings: { Networks: {} },
      HostConfig: {
        PortBindings: {
          '1337/tcp': [{ HostIp: '127.0.0.1', HostPort: '1337' }]
        }
      },
      Config: { Env: [], Labels: {} }
    }
  })

  expect(runArgs.includes('127.0.0.1:1337:1337')).toBe(true)
  expect(runArgs.includes('1337:1337')).toBe(false)
})

test('self-update collapses equivalent public IPv4 and IPv6 bindings', async ({
  sails,
  expect
}) => {
  const { runArgs } = await sails.helpers.system.buildUpdateDockerArgs.with({
    containerInfo: {
      Mounts: [],
      NetworkSettings: { Networks: {} },
      HostConfig: {
        PortBindings: {
          '1337/tcp': [
            { HostIp: '0.0.0.0', HostPort: '1337' },
            { HostIp: '::', HostPort: '1337' }
          ]
        }
      },
      Config: { Env: [], Labels: {} }
    }
  })

  expect(runArgs.filter((value) => value === '1337:1337').length).toBe(1)
})

test('self-update docker args force production node environment', async ({
  sails,
  expect
}) => {
  const { runArgs, envArgs } =
    await sails.helpers.system.buildUpdateDockerArgs.with({
      containerInfo: {
        Mounts: [],
        NetworkSettings: { Networks: {} },
        HostConfig: { PortBindings: {} },
        Config: {
          Env: ['NODE_ENV=development', 'PORT=1337', 'SLIPWAY_URL=https://x'],
          Labels: {}
        }
      }
    })

  expect(envArgs.includes('NODE_ENV=development')).toBe(false)
  expect(envArgs.includes('NODE_ENV=production')).toBe(true)
  expect(runArgs.includes('NODE_ENV=development')).toBe(false)
  expect(runArgs.includes('NODE_ENV=production')).toBe(true)
  expect(runArgs.includes('PORT=1337')).toBe(true)
  expect(runArgs.includes('SLIPWAY_URL=https://x')).toBe(true)
  expect(runArgs.includes('SLIPWAY_APP_PORT_HOST=0.0.0.0')).toBe(true)
})

test('self-update keeps an explicit private app binding', async ({
  sails,
  expect
}) => {
  const { envArgs } = await sails.helpers.system.buildUpdateDockerArgs.with({
    containerInfo: {
      Mounts: [],
      NetworkSettings: { Networks: {} },
      HostConfig: { PortBindings: {} },
      Config: {
        Env: ['SLIPWAY_APP_PORT_HOST=127.0.0.1'],
        Labels: {}
      }
    }
  })

  expect(envArgs.includes('SLIPWAY_APP_PORT_HOST=127.0.0.1')).toBe(true)
  expect(envArgs.includes('SLIPWAY_APP_PORT_HOST=0.0.0.0')).toBe(false)
})

test('self-update image refs use the advertised release tag instead of latest', async ({
  sails,
  expect
}) => {
  const imageRef = await sails.helpers.system.getUpdateImageRef.with({
    updateInfo: { latestVersion: 'v0.0.50' },
    imageRepository: 'ghcr.io/sailscastshq/slipway'
  })

  expect(imageRef).toBe('ghcr.io/sailscastshq/slipway:0.0.50')
  expect(imageRef.includes(':latest')).toBe(false)
})

test('self-update swap keeps the previous container available for rollback', async ({
  sails,
  expect
}) => {
  const targetImage = 'ghcr.io/sailscastshq/slipway:test-target'
  const script = await sails.helpers.system.buildUpdateSwapScript.with({
    runArgs: ['run', '-d', '--name', 'slipway', targetImage]
  })

  expect(script.includes(targetImage)).toBe(true)
  expect(script.includes('docker(["rename", containerName, backupName])')).toBe(
    true
  )
  expect(script.includes('docker(["stop", backupName])')).toBe(true)
  expect(script.includes('tryDocker(["rm", "-f", containerName])')).toBe(true)
  expect(script.includes('docker(["rename", backupName, containerName])')).toBe(
    true
  )
  expect(script.includes('waitForHealth()')).toBe(true)
  expect(script.includes('Rollback complete')).toBe(true)
  expect((script.match(/docker\(runArgs\)/g) || []).length).toBe(1)

  let syntaxError
  try {
    new vm.Script(script)
  } catch (error) {
    syntaxError = error
  }
  expect(syntaxError).toBe(undefined)
})

test('self-update validates without allocating or publishing a host port and cleans up failed starts', async ({
  sails,
  expect
}) => {
  const fs = require('node:fs')
  const source = fs.readFileSync(
    require.resolve('../../../../api/helpers/system/apply-update'),
    'utf8'
  )
  const token = 'fixture-only-encryption-secret'
  for (const failureAt of ['none', 'validation', 'bosun']) {
    const calls = []
    const progress = []
    const logs = []
    let swapArgs
    const context = {
      config: { custom: {} },
      cache: { set: async (key, value) => progress.push(value) },
      log: {
        info: (value) => logs.push(value),
        error: (value) => logs.push(value)
      },
      helpers: {
        docker: {
          formatError: sails.helpers.docker.formatError,
          allocatePort: {
            with: () => {
              throw new Error('Host allocation must not run')
            }
          },
          healthCheckContainer: { with: async () => {} }
        },
        system: {
          checkForUpdates: async () => ({
            updateAvailable: true,
            currentVersion: '0.0.89',
            latestVersion: '0.0.90'
          }),
          getUpdateImageRef: { with: async () => 'fixture:candidate' },
          backupDatabase: async () => ({ localVerified: true }),
          buildUpdateDockerArgs: sails.helpers.system.buildUpdateDockerArgs,
          buildUpdateSwapScript: {
            with: async ({ runArgs }) => {
              swapArgs = runArgs
              return 'fixture-swap'
            }
          }
        }
      }
    }
    const execFile = (binary, args, options, callback) => {
      if (typeof options === 'function') callback = options
      calls.push(args)
      let stdout = ''
      if (args[0] === 'inspect')
        stdout = JSON.stringify([
          {
            Mounts: [
              {
                Type: 'bind',
                Source: '/var/slipway/apps',
                Destination: '/var/slipway/apps'
              }
            ],
            NetworkSettings: { Networks: { slipway: {} } },
            HostConfig: {
              PortBindings: {
                '1337/tcp': [{ HostIp: '127.0.0.1', HostPort: '1337' }]
              }
            },
            Config: {
              Env: [
                `DATA_ENCRYPTION_KEY=${token}`,
                'SLIPWAY_APP_PORT_HOST=127.0.0.1',
                'SHORT=2'
              ],
              Labels: {}
            }
          }
        ])
      if (args[0] === 'exec') stdout = JSON.stringify({ status: 'ok' })
      const failed =
        args[0] === 'run' &&
        ((failureAt === 'validation' && args.includes('slipway-next')) ||
          (failureAt === 'bosun' && args.includes('slipway-bosun')))
      const error = failed
        ? Object.assign(new Error(`Command failed: ${args.join(' ')}`), {
            code: 1,
            stderr: `Bind for 127.0.0.1:1342 failed; DATA_ENCRYPTION_KEY=${token}`
          })
        : null
      queueMicrotask(() => callback(error, stdout, error?.stderr || ''))
    }
    // Match Node's promisified execFile stdout/stderr contract.
    execFile[require('node:util').promisify.custom] = (...args) =>
      new Promise((resolve, reject) =>
        execFile(...args, (error, stdout, stderr) =>
          error ? reject(error) : resolve({ stdout, stderr })
        )
      )
    const loaded = { exports: {} }
    vm.runInNewContext(source, {
      module: loaded,
      sails: context,
      require: (name) =>
        name === 'child_process' ? { execFile } : require(name)
    })
    let failure
    try {
      await loaded.exports.fn()
    } catch (error) {
      failure = error
    }
    const validationArgs = calls.find(
      (args) => args[0] === 'run' && args.includes('slipway-next')
    )
    expect(validationArgs.includes('-p')).toBe(false)
    expect(validationArgs.includes('--network')).toBe(true)
    expect(validationArgs.includes(`DATA_ENCRYPTION_KEY=${token}`)).toBe(true)
    expect(
      calls.filter((args) => args.join(' ') === 'rm -f slipway-next').length
    ).toBe(2)
    expect(JSON.stringify(progress).includes(token)).toBe(false)
    if (failureAt === 'validation') {
      expect(failure).toBe('validationFailed')
      expect(swapArgs).toBe(undefined)
      expect(logs.join('\n').includes(token)).toBe(false)
      expect(logs.join('\n').includes('127.0.0.1:1342')).toBe(true)
      expect(
        progress.some((value) => value?.detail === 'New image failed to start')
      ).toBe(true)
    } else if (failureAt === 'bosun') {
      expect(failure).toBe('pullFailed')
      expect(
        progress.some((value) => value?.detail?.includes('127.0.0.1:1342'))
      ).toBe(true)
    } else {
      expect(failure).toBe(undefined)
      expect(swapArgs.includes('127.0.0.1:1337:1337')).toBe(true)
    }
  }
})

test('Bosun protects Docker failure diagnostics and restores the previous container', async ({
  sails,
  expect
}) => {
  const token = 'fixture-only-encryption-secret'
  const script = await sails.helpers.system.buildUpdateSwapScript.with({
    runArgs: [
      'run',
      '-d',
      '--name',
      'slipway',
      '-e',
      `DATA_ENCRYPTION_KEY=${token}`,
      '-e',
      'SHORT=2',
      '-e',
      'SLIPWAY_APP_PORT_HOST=127.0.0.1',
      'fixture:candidate'
    ]
  })
  const calls = []
  const logs = []
  let exit
  vm.runInNewContext(script, {
    require: (name) =>
      name === 'child_process'
        ? {
            execFileSync: (binary, args, options) => {
              calls.push(args)
              expect(options.stdio).toBe('pipe')
              if (args[0] === 'run')
                throw Object.assign(
                  new Error(`Command failed: ${args.join(' ')}`),
                  {
                    stderr: `Bind for 127.0.0.1:1342 failed; DATA_ENCRYPTION_KEY=${token}`
                  }
                )
              return Buffer.from('')
            }
          }
        : require(name),
    Buffer,
    setTimeout: (callback) => callback(),
    console: {
      log: (...args) => logs.push(args.join(' ')),
      error: (...args) => logs.push(args.join(' '))
    },
    process: {
      exit: (code) => {
        exit = code
      }
    }
  })
  expect(exit).toBe(1)
  expect(logs.join('\n').includes(token)).toBe(false)
  expect(logs.join('\n').includes('127.0.0.1:1342')).toBe(true)
  expect(
    calls.some((args) => args.join(' ') === 'rename slipway-previous slipway')
  ).toBe(true)
  expect(calls.some((args) => args.join(' ') === 'start slipway')).toBe(true)
  const format = sails.helpers.docker.formatError
  expect(
    format
      .with({ error: new Error(`Command failed -e KEY=${token}`) })
      .includes(token)
  ).toBe(false)
  expect(
    format.with({
      error: { stderr: token.repeat(10000) },
      args: ['-e', `KEY=${token}`]
    })
  ).toBe('Docker command failed; oversized diagnostic withheld.')
})

test('legacy updater bootstrap refuses unknown sources and is idempotent without opening databases', async ({
  expect
}) => {
  const fs = require('node:fs/promises')
  const path = require('node:path')
  const { execFileSync } = require('node:child_process')
  const root = await fs.mkdtemp(
    path.join(require('node:os').tmpdir(), 'slipway-bootstrap-')
  )
  const helper = path.join(root, 'api/helpers/system/apply-update.js')
  const script = path.resolve('scripts/bootstrap-unpublished-update.cjs')
  try {
    await fs.mkdir(path.dirname(helper), { recursive: true })
    await fs.writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({ version: '0.0.89' })
    )
    await fs.writeFile(helper, 'module.exports = {}')
    let failure
    try {
      execFileSync(process.execPath, [script, root], { stdio: 'pipe' })
    } catch (error) {
      failure = error
    }
    expect(failure.status).toBe(1)
    expect(await fs.readFile(helper, 'utf8')).toBe('module.exports = {}')
    const source =
      "module.exports = { fn: async function () { tempArgs.push('-p', formatPortBinding(portHost, tempPort, 1337))\n await sails.helpers.docker.healthCheckContainer.with({}); return 'http://localhost:1337/health' } }"
    await fs.writeFile(helper, source)
    execFileSync(process.execPath, [script, root], { stdio: 'pipe' })
    const patched = await fs.readFile(helper, 'utf8')
    expect(patched.includes("tempArgs.push('-p'")).toBe(false)
    const result = execFileSync(process.execPath, [script, root], {
      encoding: 'utf8',
      stdio: 'pipe'
    })
    expect(result.includes('already patched')).toBe(true)
    expect(await fs.readFile(helper, 'utf8')).toBe(patched)
    const backups = (await fs.readdir(path.dirname(helper))).filter((name) =>
      name.includes('before-port-bootstrap')
    )
    expect(backups.length).toBe(1)
    const backup = path.join(path.dirname(helper), backups[0])
    expect(await fs.readFile(backup, 'utf8')).toBe(source)
    expect((await fs.stat(backup)).mode & 0o777).toBe(0o600)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
