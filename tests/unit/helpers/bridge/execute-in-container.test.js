const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const { test } = require('sounding')

test('Bridge workers load the deployed app in production', async ({
  sails,
  expect
}) => {
  const temporaryDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'slipway-bridge-worker-')
  )
  const fakeDockerPath = path.join(temporaryDirectory, 'docker')
  const capturedArgumentsPath = path.join(temporaryDirectory, 'arguments.json')
  const previousDockerConfig = sails.config.docker
  const previousCapturePath = process.env.SLIPWAY_FAKE_DOCKER_ARGS_PATH

  await fs.writeFile(
    fakeDockerPath,
    [
      '#!/usr/bin/env node',
      "const fs = require('node:fs')",
      'fs.writeFileSync(',
      '  process.env.SLIPWAY_FAKE_DOCKER_ARGS_PATH,',
      '  JSON.stringify(process.argv.slice(2))',
      ')',
      "process.stdin.on('data', () => {})",
      "process.stdin.on('end', () => {",
      "  process.stdout.write('___SLIPWAY_BRIDGE_START___' + JSON.stringify({ ready: true }) + '___SLIPWAY_BRIDGE_END___')",
      '})'
    ].join('\n'),
    { mode: 0o755 }
  )
  sails.config.docker = {
    ...(previousDockerConfig || {}),
    binaryPath: fakeDockerPath
  }
  process.env.SLIPWAY_FAKE_DOCKER_ARGS_PATH = capturedArgumentsPath

  try {
    const result = await sails.helpers.bridge.executeInContainer.with({
      containerName: 'sailscasts-production',
      code: 'return { ready: true }'
    })
    const argumentsPassedToDocker = JSON.parse(
      await fs.readFile(capturedArgumentsPath, 'utf8')
    )

    expect(result.success).toBe(true)
    expect(result.output).toBe('{"ready":true}')
    expect(argumentsPassedToDocker).toEqual([
      'exec',
      '-e',
      'NODE_ENV=production',
      '-i',
      'sailscasts-production',
      'node'
    ])
  } finally {
    sails.config.docker = previousDockerConfig
    if (previousCapturePath === undefined) {
      delete process.env.SLIPWAY_FAKE_DOCKER_ARGS_PATH
    } else {
      process.env.SLIPWAY_FAKE_DOCKER_ARGS_PATH = previousCapturePath
    }
    await fs.rm(temporaryDirectory, { recursive: true, force: true })
  }
})
