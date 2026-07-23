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
  const originalDockerPath = sails.config.docker?.binaryPath
  fs.writeFileSync(
    dockerPath,
    '#!/bin/sh\ntrap "exit 0" TERM\nwhile true; do sleep 1; done\n'
  )
  fs.chmodSync(dockerPath, 0o755)
  sails.config.docker = sails.config.docker || {}
  sails.config.docker.binaryPath = dockerPath

  const controller = new AbortController()
  const cancellation = new Error('Cancelled by Builder')
  cancellation.code = 'DEPLOYMENT_CANCELLED'
  const startedAt = Date.now()

  try {
    const build = sails.helpers.docker.buildImage.with({
      contextPath: tempRoot,
      imageName: 'slipway/cancelled:latest',
      timeout: 10_000,
      signal: controller.signal
    })
    setTimeout(() => controller.abort(cancellation), 30)

    let error
    try {
      await build
    } catch (err) {
      error = err
    }

    expect(error.code).toBe('DEPLOYMENT_CANCELLED')
    expect(Date.now() - startedAt < 1000).toBe(true)
  } finally {
    if (originalDockerPath === undefined) {
      delete sails.config.docker.binaryPath
    } else {
      sails.config.docker.binaryPath = originalDockerPath
    }
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})
