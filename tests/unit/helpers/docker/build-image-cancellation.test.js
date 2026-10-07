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

test(
  'Docker build buffers split credentials before logger and database writes',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'build-secret-stream' } }
    }
  },
  async ({ sails, world, expect }) => {
    const secret = 'build-split-credential-718'
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slipway-build-secret-'))
    const executable = path.join(root, 'docker')
    const ready = path.join(root, 'ready')
    const continuePath = path.join(root, 'continue')
    const originalPath = sails.config.docker?.binaryPath
    const originalLogger = sails.log.verbose
    const messages = []
    const deployment = await world.create('deployment').with({
      environment: world.current.environments.production.id,
      app: world.current.apps.web.id
    })
    fs.writeFileSync(
      executable,
      [
        '#!/usr/bin/env node',
        "const fs = require('node:fs')",
        `process.stdout.write(${JSON.stringify(secret.slice(0, 12))})`,
        `fs.writeFileSync(${JSON.stringify(ready)}, 'ready')`,
        'const timer = setInterval(() => {',
        `  if (!fs.existsSync(${JSON.stringify(continuePath)})) return`,
        '  clearInterval(timer)',
        `  process.stdout.write(${JSON.stringify(
          secret.slice(12) + '\nfinished\n'
        )})`,
        `  process.stderr.write(${JSON.stringify(secret)})`,
        '}, 10)',
        ''
      ].join('\n')
    )
    fs.chmodSync(executable, 0o755)
    sails.config.docker = sails.config.docker || {}
    sails.config.docker.binaryPath = executable
    sails.log.verbose = (text) => messages.push(text)
    let build
    try {
      build = sails.helpers.docker.buildImage.with({
        contextPath: root,
        imageName: 'slipway/secret-proof:latest',
        deploymentId: deployment.id,
        buildArgs: { UNUSUAL_NAME: secret },
        timeout: 5000
      })
      // Start the deferred helper before waiting on its process marker.
      const completion = Promise.resolve(build)
      await waitFor(() => fs.existsSync(ready))
      const interim = await sails.models.deployment.findOne(deployment.id)
      expect((interim.buildLogs || '').includes(secret.slice(0, 12))).toBe(
        false
      )
      expect(messages.join('').includes(secret.slice(0, 12))).toBe(false)
      fs.writeFileSync(continuePath, 'continue')
      const result = await completion
      const saved = await sails.models.deployment.findOne(deployment.id)
      expect(result.output).toBe('[REDACTED]\nfinished\n')
      expect(saved.buildLogs.includes('[REDACTED]')).toBe(true)
      expect(saved.buildLogs.includes(secret)).toBe(false)
      expect(messages.join('').includes(secret)).toBe(false)
    } finally {
      fs.writeFileSync(continuePath, 'continue')
      if (build) await build.catch(() => {})
      sails.config.docker.binaryPath = originalPath
      sails.log.verbose = originalLogger
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
)
