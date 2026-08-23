const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const { test } = require('sounding')

test('Bridge reuses one production worker for warm operations', async ({
  sails,
  expect
}) => {
  const fixture = await createFakeDockerFixture()
  const restore = useFakeDocker(sails, fixture)
  process.env.SLIPWAY_FAKE_DOCKER_EXIT_AFTER = '2'

  try {
    const first = await sails.helpers.bridge.executeInContainer.with({
      containerName: 'sailscasts-production',
      code: 'return { operation: "dashboard" }'
    })
    const second = await sails.helpers.bridge.executeInContainer.with({
      containerName: 'sailscasts-production',
      code: 'return { operation: "search" }'
    })
    const argumentsPassedToDocker = JSON.parse(
      await fs.readFile(fixture.argumentsPath, 'utf8')
    )

    expect(first.success).toBe(true)
    expect(JSON.parse(first.output)).toEqual({
      code: 'return { operation: "dashboard" }'
    })
    expect(second.success).toBe(true)
    expect(JSON.parse(second.output)).toEqual({
      code: 'return { operation: "search" }'
    })
    expect(await readBootCount(fixture.bootCountPath)).toBe(1)
    expect(argumentsPassedToDocker.slice(0, 7)).toEqual([
      'exec',
      '-e',
      'NODE_ENV=production',
      '-i',
      'sailscasts-production',
      'node',
      '-e'
    ])
    expect(argumentsPassedToDocker[7]).toContain('sailsApp.load')
    expect(argumentsPassedToDocker[7]).toContain("migrate: 'safe'")
    expect(argumentsPassedToDocker[7]).toContain('http: false')
  } finally {
    restore()
    delete process.env.SLIPWAY_FAKE_DOCKER_EXIT_AFTER
    await fs.rm(fixture.directory, { recursive: true, force: true })
  }
})

test('Bridge replaces a timed-out worker before the next operation', async ({
  sails,
  expect
}) => {
  const fixture = await createFakeDockerFixture()
  const restore = useFakeDocker(sails, fixture)
  process.env.SLIPWAY_FAKE_DOCKER_EXIT_AFTER = '1'

  try {
    const timedOut = await sails.helpers.bridge.executeInContainer.with({
      containerName: 'sailscasts-timeout',
      code: '/* never finishes */',
      timeout: 1000
    })
    const recovered = await sails.helpers.bridge.executeInContainer.with({
      containerName: 'sailscasts-timeout',
      code: 'return { operation: "recovered" }'
    })

    expect(timedOut.success).toBe(false)
    expect(timedOut.error).toMatch(/timed out after 1000ms/)
    expect(recovered.success).toBe(true)
    expect(JSON.parse(recovered.output)).toEqual({
      code: 'return { operation: "recovered" }'
    })
    expect(await readBootCount(fixture.bootCountPath)).toBe(2)
  } finally {
    restore()
    delete process.env.SLIPWAY_FAKE_DOCKER_EXIT_AFTER
    await fs.rm(fixture.directory, { recursive: true, force: true })
  }
})

async function createFakeDockerFixture() {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'slipway-bridge-worker-')
  )
  const dockerPath = path.join(directory, 'docker')
  const argumentsPath = path.join(directory, 'arguments.json')
  const bootCountPath = path.join(directory, 'boot-count.txt')

  await fs.writeFile(
    dockerPath,
    [
      '#!/usr/bin/env node',
      "const fs = require('node:fs')",
      "const readline = require('node:readline')",
      "const marker = '___SLIPWAY_BRIDGE_WORKER_RESULT___'",
      'const argumentsPath = process.env.SLIPWAY_FAKE_DOCKER_ARGS_PATH',
      'const bootCountPath = process.env.SLIPWAY_FAKE_DOCKER_BOOT_COUNT_PATH',
      "fs.appendFileSync(bootCountPath, 'boot\\n')",
      'fs.writeFileSync(argumentsPath, JSON.stringify(process.argv.slice(2)))',
      'const input = readline.createInterface({ input: process.stdin })',
      'let handled = 0',
      "input.on('line', (line) => {",
      '  const job = JSON.parse(line)',
      "  if (job.code.includes('never finishes')) return",
      '  handled += 1',
      '  const response = {',
      '    id: job.id,',
      '    success: true,',
      '    output: JSON.stringify({ code: job.code }),',
      '    error: null',
      '  }',
      "  process.stdout.write('target app noise\\n' + marker + JSON.stringify(response) + '\\n', () => {",
      '    if (handled === Number(process.env.SLIPWAY_FAKE_DOCKER_EXIT_AFTER || 0)) process.exit(0)',
      '  })',
      '})'
    ].join('\n'),
    { mode: 0o755 }
  )

  return { directory, dockerPath, argumentsPath, bootCountPath }
}

function useFakeDocker(sails, fixture) {
  const previousDockerConfig = sails.config.docker
  const previousArgumentsPath = process.env.SLIPWAY_FAKE_DOCKER_ARGS_PATH
  const previousBootCountPath = process.env.SLIPWAY_FAKE_DOCKER_BOOT_COUNT_PATH

  sails.config.docker = {
    ...(previousDockerConfig || {}),
    binaryPath: fixture.dockerPath
  }
  process.env.SLIPWAY_FAKE_DOCKER_ARGS_PATH = fixture.argumentsPath
  process.env.SLIPWAY_FAKE_DOCKER_BOOT_COUNT_PATH = fixture.bootCountPath

  return function restore() {
    sails.config.docker = previousDockerConfig
    restoreEnvironment('SLIPWAY_FAKE_DOCKER_ARGS_PATH', previousArgumentsPath)
    restoreEnvironment(
      'SLIPWAY_FAKE_DOCKER_BOOT_COUNT_PATH',
      previousBootCountPath
    )
  }
}

function restoreEnvironment(name, value) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

async function readBootCount(bootCountPath) {
  const boots = await fs.readFile(bootCountPath, 'utf8')
  return boots.trim().split('\n').length
}
