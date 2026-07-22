const fs = require('fs')
const os = require('os')
const path = require('path')

const { test } = require('sounding')

const getSourceReadiness = require('../../../../api/helpers/deploy/get-source-readiness')

test('CLI-pushed source is reported as deployable without a repository', async ({
  expect
}) => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'slipway-source-readiness-')
  )
  const contextPath = path.join(tempRoot, 'demo')
  fs.mkdirSync(contextPath, { recursive: true })
  fs.writeFileSync(path.join(contextPath, 'Dockerfile'), 'FROM node:22\n')

  const originalSails = global.sails
  const originalGitRepository = global.GitRepository
  global.sails = { config: { custom: { slipwayAppsDir: tempRoot } } }
  global.GitRepository = {
    findOne: () => ({ decrypt: async () => null })
  }

  try {
    const result = await getSourceReadiness.fn({
      project: { slug: 'demo' },
      environment: { id: 1 },
      app: { id: 1 }
    })

    expect(result.available).toBe(true)
    expect(result.mode).toBe('pushed')
    expect(result.message).toContain('CLI-pushed source')
  } finally {
    global.sails = originalSails
    global.GitRepository = originalGitRepository
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('missing source returns actionable deployment guidance', async ({
  expect
}) => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'slipway-source-readiness-')
  )
  const originalSails = global.sails
  const originalGitRepository = global.GitRepository
  global.sails = { config: { custom: { slipwayAppsDir: tempRoot } } }
  global.GitRepository = {
    findOne: () => ({ decrypt: async () => null })
  }

  try {
    const result = await getSourceReadiness.fn({
      project: { slug: 'demo' },
      environment: { id: 1 },
      app: { id: 1 }
    })

    expect(result.available).toBe(false)
    expect(result.mode).toBe('none')
    expect(result.message).toContain('slipway slide')
    expect(result.message).toContain('connect a repository')
  } finally {
    global.sails = originalSails
    global.GitRepository = originalGitRepository
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('CLI-pushed source remains usable when a repository connection is incomplete', async ({
  expect
}) => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'slipway-source-readiness-')
  )
  const contextPath = path.join(tempRoot, 'demo')
  fs.mkdirSync(contextPath, { recursive: true })
  fs.writeFileSync(path.join(contextPath, 'Dockerfile'), 'FROM node:22\n')

  const originalSails = global.sails
  const originalGitRepository = global.GitRepository
  global.sails = { config: { custom: { slipwayAppsDir: tempRoot } } }
  global.GitRepository = {
    findOne: () => ({
      decrypt: async () => ({
        fullName: 'acme/incomplete',
        cloneUrl: null,
        deployKeyPrivate: null
      })
    })
  }

  try {
    const result = await getSourceReadiness.fn({
      project: { slug: 'demo' },
      environment: { id: 1 },
      app: { id: 1 }
    })

    expect(result.available).toBe(true)
    expect(result.mode).toBe('pushed')
    expect(result.message).toContain('CLI-pushed source')
  } finally {
    global.sails = originalSails
    global.GitRepository = originalGitRepository
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})
