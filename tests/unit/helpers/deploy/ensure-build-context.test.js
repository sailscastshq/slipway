const fs = require('fs')
const os = require('os')
const path = require('path')

const { test } = require('sounding')

const ensureBuildContext = require('../../../../api/helpers/deploy/ensure-build-context')

test('missing build context is hydrated from a connected repository', async ({
  expect
}) => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'slipway-ensure-build-context-')
  )
  const cloneCalls = []
  const buildLogs = []
  const originalSails = global.sails
  const originalGitRepository = global.GitRepository
  const originalDeployment = global.Deployment

  global.sails = {
    config: {
      custom: {
        slipwayAppsDir: tempRoot
      }
    },
    helpers: {
      git: {
        cloneOrPull: {
          with: async (options) => {
            cloneCalls.push(options)
            fs.mkdirSync(options.targetDir, { recursive: true })
            fs.writeFileSync(
              path.join(options.targetDir, 'Dockerfile'),
              'FROM node:22-alpine\n'
            )
          }
        }
      }
    }
  }

  global.GitRepository = {
    findOne: (criteria) => ({
      decrypt: async () =>
        criteria.app === 1
          ? {
              fullName: 'acme/sailscasts',
              cloneUrl: 'git@github.com:acme/sailscasts.git',
              defaultBranch: 'main',
              deployKeyPrivate:
                '-----BEGIN TEST KEY-----\nabc\n-----END TEST KEY-----',
              branchMappings: {
                production: 'production'
              }
            }
          : null
    })
  }

  global.Deployment = {
    appendBuildLog: async (_deploymentId, message) => {
      buildLogs.push(message)
    }
  }

  try {
    const result = await ensureBuildContext.fn({
      project: { slug: 'sailscasts' },
      environment: { id: 1, slug: 'production' },
      app: { id: 1 },
      deploymentId: 'dep-1'
    })

    expect(result.contextPath).toBe(path.join(tempRoot, 'sailscasts'))
    expect(result.hydrated).toBe(true)
    expect(result.branch).toBe('production')
    expect(cloneCalls).toEqual([
      {
        cloneUrl: 'git@github.com:acme/sailscasts.git',
        branch: 'production',
        targetDir: path.join(tempRoot, 'sailscasts'),
        deployKeyPrivate:
          '-----BEGIN TEST KEY-----\nabc\n-----END TEST KEY-----',
        deploymentId: 'dep-1'
      }
    ])
    expect(buildLogs[0]).toContain('Build context missing at')
    expect(fs.existsSync(path.join(tempRoot, 'sailscasts'))).toBe(true)
  } finally {
    global.sails = originalSails
    global.GitRepository = originalGitRepository
    global.Deployment = originalDeployment
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('connected repository refreshes an existing source cache before a manual deploy', async ({
  expect
}) => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'slipway-ensure-build-context-')
  )
  const contextPath = path.join(tempRoot, 'sailscasts')
  fs.mkdirSync(contextPath, { recursive: true })
  fs.writeFileSync(path.join(contextPath, 'Dockerfile'), 'FROM node:20\n')

  const cloneCalls = []
  const originalSails = global.sails
  const originalGitRepository = global.GitRepository
  const originalDeployment = global.Deployment

  global.sails = {
    config: { custom: { slipwayAppsDir: tempRoot } },
    helpers: {
      git: {
        cloneOrPull: {
          with: async (options) => {
            cloneCalls.push(options)
            fs.writeFileSync(
              path.join(options.targetDir, 'Dockerfile'),
              'FROM node:22\n'
            )
          }
        }
      }
    }
  }
  global.GitRepository = {
    findOne: () => ({
      decrypt: async () => ({
        fullName: 'acme/sailscasts',
        cloneUrl: 'git@github.com:acme/sailscasts.git',
        defaultBranch: 'main',
        deployKeyPrivate: 'test-key',
        branchMappings: { main: 'production' }
      })
    })
  }
  global.Deployment = { appendBuildLog: async () => {} }

  try {
    const result = await ensureBuildContext.fn({
      project: { slug: 'sailscasts' },
      environment: { id: 1, slug: 'production' },
      app: { id: 1 },
      gitCommit: '1234567890abcdef1234567890abcdef12345678',
      refreshRepository: true
    })

    expect(result.hydrated).toBe(true)
    expect(result.sourceMode).toBe('repository')
    expect(cloneCalls.length).toBe(1)
    expect(cloneCalls[0].branch).toBe('main')
    expect(cloneCalls[0].commit).toBe(
      '1234567890abcdef1234567890abcdef12345678'
    )
  } finally {
    global.sails = originalSails
    global.GitRepository = originalGitRepository
    global.Deployment = originalDeployment
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('missing build context fails early with guidance when no repository is connected', async ({
  expect
}) => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'slipway-ensure-build-context-')
  )
  const buildLogs = []
  const originalSails = global.sails
  const originalGitRepository = global.GitRepository
  const originalDeployment = global.Deployment

  global.sails = {
    config: {
      custom: {
        slipwayAppsDir: tempRoot
      }
    },
    helpers: {
      git: {
        cloneOrPull: {
          with: async () => {
            throw new Error('clone should not be called')
          }
        }
      }
    }
  }

  global.GitRepository = {
    findOne: () => ({
      decrypt: async () => null
    })
  }

  global.Deployment = {
    appendBuildLog: async (_deploymentId, message) => {
      buildLogs.push(message)
    }
  }

  try {
    let caughtError
    try {
      await ensureBuildContext.fn({
        project: { slug: 'sailscasts' },
        environment: { id: 1, slug: 'production' },
        app: { id: 1 },
        deploymentId: 'dep-1'
      })
    } catch (err) {
      caughtError = err
    }

    expect(caughtError?.message).toBe(
      `Build context missing at ${path.join(
        tempRoot,
        'sailscasts'
      )}. Push source to Slipway or connect a repository before deploying.`
    )
    expect(buildLogs[0]).toContain(
      'Push source to Slipway or connect a repository before deploying.'
    )
  } finally {
    global.sails = originalSails
    global.GitRepository = originalGitRepository
    global.Deployment = originalDeployment
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})
