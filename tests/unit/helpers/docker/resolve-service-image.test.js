const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { test } = require('sounding')

test('image resolution uses an immutable local digest when the registry is offline', async ({
  sails,
  expect
}) => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'slipway-service-image-')
  )
  const dockerPath = path.join(tempRoot, 'docker')
  const originalDockerPath = sails.config.docker?.binaryPath
  fs.writeFileSync(
    dockerPath,
    [
      '#!/usr/bin/env node',
      'const args = process.argv.slice(2)',
      "if (args[0] === 'pull') {",
      "  process.stderr.write('registry unavailable')",
      '  process.exit(1)',
      '}',
      "if (args[0] === 'image' && args[1] === 'inspect') {",
      '  process.stdout.write(JSON.stringify([{',
      "    Id: 'sha256:local-image-id',",
      "    RepoDigests: ['postgres@sha256:immutable-digest'],",
      "    RepoTags: ['postgres:17']",
      '  }]))',
      '  process.exit(0)',
      '}',
      'process.exit(2)',
      ''
    ].join('\n')
  )
  fs.chmodSync(dockerPath, 0o755)
  sails.config.docker = sails.config.docker || {}
  sails.config.docker.binaryPath = dockerPath

  try {
    const result = await sails.helpers.docker.resolveServiceImage.with({
      type: 'postgresql',
      version: '17'
    })

    expect(result.imageReference).toBe('postgres@sha256:immutable-digest')
    expect(result.usedLocalFallback).toBe(true)
  } finally {
    if (originalDockerPath === undefined) {
      delete sails.config.docker.binaryPath
    } else {
      sails.config.docker.binaryPath = originalDockerPath
    }
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})
