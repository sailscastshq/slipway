const fs = require('fs')
const os = require('os')
const path = require('path')

const { test } = require('sounding')

test('docker image build terminates its process when the deployment is cancelled', async ({
  sails,
  expect
}) => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'slipway-cancel-build-')
  )
  const dockerPath = path.join(tempRoot, 'docker')
  const readyPath = path.join(tempRoot, 'ready')
  const terminatedPath = path.join(tempRoot, 'terminated')
  const originalDockerPath = sails.config.docker?.binaryPath
  const originalInfoLogger = sails.log.info
  const logMessages = []
  fs.writeFileSync(
    dockerPath,
    [
      '#!/usr/bin/env node',
      "const fs = require('node:fs')",
      "process.on('SIGTERM', () => {",
      `  fs.writeFileSync(${JSON.stringify(terminatedPath)}, 'SIGTERM')`,
      '  process.exit(0)',
      '})',
      `fs.writeFileSync(${JSON.stringify(readyPath)}, 'ready')`,
      'setInterval(() => {}, 1000)',
      ''
    ].join('\n')
  )
  fs.chmodSync(dockerPath, 0o755)
  sails.config.docker = sails.config.docker || {}
  sails.config.docker.binaryPath = dockerPath
  sails.log.info = (...values) => logMessages.push(values.join(' '))

  const controller = new AbortController()
  const cancellation = new Error('Cancelled by Builder')
  cancellation.code = 'DEPLOYMENT_CANCELLED'
  let build
  let buildError

  try {
    build = sails.helpers.docker.buildImage
      .with({
        contextPath: tempRoot,
        imageName: 'slipway/cancelled:latest',
        buildArgs: {
          NPM_TOKEN: 'should-reach-docker-but-never-logs'
        },
        timeout: 10_000,
        signal: controller.signal
      })
      .catch((error) => {
        buildError = error
      })
    await waitFor(() => fs.existsSync(readyPath))
    controller.abort(cancellation)
    await build

    expect(buildError.code).toBe('DEPLOYMENT_CANCELLED')
    expect(fs.readFileSync(terminatedPath, 'utf8')).toBe('SIGTERM')
    expect(logMessages.join('\n')).toMatch(
      /Building image: slipway\/cancelled:latest/
    )
    expect(logMessages.join('\n').includes('NPM_TOKEN=')).toBe(false)
    expect(
      logMessages.join('\n').includes('should-reach-docker-but-never-logs')
    ).toBe(false)
  } finally {
    if (!controller.signal.aborted) controller.abort(cancellation)
    if (build) await build
    if (originalDockerPath === undefined) {
      delete sails.config.docker.binaryPath
    } else {
      sails.config.docker.binaryPath = originalDockerPath
    }
    sails.log.info = originalInfoLogger
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

async function waitFor(predicate, timeout = 5000) {
  const deadline = Date.now() + timeout
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for the fake Docker process.')
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
