const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const { test } = require('sounding')

test('Docker environment arguments expand runtime port references without mutating saved values', async ({
  sails,
  expect
}) => {
  const envVars = {
    PDF_BASE_URL: 'http://127.0.0.1:$PORT',
    HEALTH_URL: 'http://127.0.0.1:${PORT}/health',
    NODE_ENV: 'production'
  }
  const original = { ...envVars }

  const args = sails.helpers.docker.buildEnvArguments.with({
    envVars,
    runtimeValues: { PORT: 1337 }
  })

  expect(args).toEqual([
    '-e',
    'PDF_BASE_URL=http://127.0.0.1:1337',
    '-e',
    'HEALTH_URL=http://127.0.0.1:1337/health',
    '-e',
    'NODE_ENV=production'
  ])
  expect(envVars).toEqual(original)
})

test('Docker environment arguments resolve merged and nested references', async ({
  sails,
  expect
}) => {
  const args = sails.helpers.docker.buildEnvArguments.with({
    envVars: {
      HOST: 'app.internal',
      ORIGIN: 'http://$HOST:${PORT}',
      HEALTH_URL: '${ORIGIN}/health',
      TELEMETRY_COPY: '$SLIPWAY_TELEMETRY_URL',
      SLIPWAY_TELEMETRY_URL: 'http://slipway:1337/api/v1/telemetry/ingest'
    },
    runtimeValues: { PORT: 1337 }
  })

  expect(args).toEqual([
    '-e',
    'HOST=app.internal',
    '-e',
    'ORIGIN=http://app.internal:1337',
    '-e',
    'HEALTH_URL=http://app.internal:1337/health',
    '-e',
    'TELEMETRY_COPY=http://slipway:1337/api/v1/telemetry/ingest',
    '-e',
    'SLIPWAY_TELEMETRY_URL=http://slipway:1337/api/v1/telemetry/ingest'
  ])
})

test('Docker environment arguments preserve unknown, escaped, cyclic, and shell-like values safely', async ({
  sails,
  expect
}) => {
  const args = sails.helpers.docker.buildEnvArguments.with({
    envVars: {
      UNKNOWN: '$NOT_CONFIGURED/${ALSO_MISSING}',
      ESCAPED: 'literal=$$PORT resolved=$PORT',
      FIRST: '$SECOND',
      SECOND: '$FIRST',
      SELF: 'prefix-$SELF-$PORT',
      COMMAND_SUBSTITUTION: '$(touch /tmp/should-never-run)',
      BACKTICKS: '`touch /tmp/should-never-run-either`',
      NUMBER: 42,
      ENABLED: true
    },
    runtimeValues: { PORT: 1337 }
  })

  expect(args).toEqual([
    '-e',
    'UNKNOWN=$NOT_CONFIGURED/${ALSO_MISSING}',
    '-e',
    'ESCAPED=literal=$PORT resolved=1337',
    '-e',
    'FIRST=$SECOND',
    '-e',
    'SECOND=$FIRST',
    '-e',
    'SELF=prefix-$SELF-1337',
    '-e',
    'COMMAND_SUBSTITUTION=$(touch /tmp/should-never-run)',
    '-e',
    'BACKTICKS=`touch /tmp/should-never-run-either`',
    '-e',
    'NUMBER=42',
    '-e',
    'ENABLED=true'
  ])
})

test('Docker environment argument expansion stops deep and oversized reference graphs safely', async ({
  sails,
  expect
}) => {
  const deepReferences = {}
  for (let index = 0; index < 70; index++) {
    deepReferences[`VALUE_${index}`] = `$VALUE_${index + 1}`
  }
  deepReferences.VALUE_70 = 'resolved'

  const deepArguments = sails.helpers.docker.buildEnvArguments.with({
    envVars: deepReferences
  })

  expect(deepArguments[1]).toBe('VALUE_0=$VALUE_1')

  const expandingReferences = { VALUE_0: 'xx' }
  for (let index = 1; index <= 20; index++) {
    expandingReferences[`VALUE_${index}`] = `$VALUE_${index - 1}$VALUE_${
      index - 1
    }`
  }

  let expansionError
  try {
    sails.helpers.docker.buildEnvArguments.with({
      envVars: expandingReferences
    })
  } catch (error) {
    expansionError = error
  }

  expect(expansionError).toBeDefined()
  expect(expansionError.message).toMatch(
    /Expanded value for environment variable "VALUE_20" exceeds the 1 MiB safety limit/
  )
})

test('runContainer gives Docker expanded environment arguments for its actual internal port', async ({
  sails,
  expect
}) => {
  const temporaryDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'slipway-docker-env-')
  )
  const fakeDockerPath = path.join(temporaryDirectory, 'docker')
  const capturedArgumentsPath = path.join(temporaryDirectory, 'arguments.json')
  const previousDockerConfig = sails.config.docker
  const previousCapturePath = process.env.SLIPWAY_FAKE_DOCKER_ARGS_PATH
  const originalGetPortBinding = sails.helpers.docker.getPortBinding

  await fs.writeFile(
    fakeDockerPath,
    [
      '#!/usr/bin/env node',
      "const fs = require('node:fs')",
      'fs.writeFileSync(',
      '  process.env.SLIPWAY_FAKE_DOCKER_ARGS_PATH,',
      '  JSON.stringify(process.argv.slice(2))',
      ')',
      "process.stdout.write('0123456789abcdef\\n')"
    ].join('\n'),
    { mode: 0o755 }
  )

  sails.config.docker = {
    ...(previousDockerConfig || {}),
    binaryPath: fakeDockerPath
  }
  process.env.SLIPWAY_FAKE_DOCKER_ARGS_PATH = capturedArgumentsPath
  sails.helpers.docker.getPortBinding = {
    with: async ({ host, hostPort, containerPort }) => ({
      valid: true,
      host,
      hostPort,
      containerPort,
      diagnostic: `${host}:${hostPort} -> ${containerPort}/tcp`
    })
  }

  try {
    await sails.helpers.docker.runContainer.with({
      imageName: 'example/app:test',
      containerName: 'example-app-test',
      port: 1337,
      hostPort: 1400,
      host: '127.0.0.1',
      envVars: {
        PDF_BASE_URL: 'http://127.0.0.1:$PORT',
        HEALTH_URL: 'http://127.0.0.1:${PORT}/health'
      }
    })

    const dockerArguments = JSON.parse(
      await fs.readFile(capturedArgumentsPath, 'utf8')
    )
    const environmentArguments = collectEnvironmentArguments(dockerArguments)

    expect(environmentArguments).toEqual([
      'PDF_BASE_URL=http://127.0.0.1:1337',
      'HEALTH_URL=http://127.0.0.1:1337/health'
    ])
  } finally {
    sails.helpers.docker.getPortBinding = originalGetPortBinding
    sails.config.docker = previousDockerConfig

    if (previousCapturePath === undefined) {
      delete process.env.SLIPWAY_FAKE_DOCKER_ARGS_PATH
    } else {
      process.env.SLIPWAY_FAKE_DOCKER_ARGS_PATH = previousCapturePath
    }

    await fs.rm(temporaryDirectory, { recursive: true, force: true })
  }
})

function collectEnvironmentArguments(dockerArguments) {
  const values = []

  for (let index = 0; index < dockerArguments.length; index++) {
    if (dockerArguments[index] === '-e') {
      values.push(dockerArguments[index + 1])
      index += 1
    }
  }

  return values
}
