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
