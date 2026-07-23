const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { test } = require('sounding')

test('deployment cleanup removes only its owned temporary build context', async ({
  sails,
  expect
}) => {
  const deploymentId = `cleanup-${Date.now()}`
  const ownedRoot = path.join(
    os.tmpdir(),
    'slipway',
    'deployments',
    deploymentId
  )
  const ownedContext = path.join(ownedRoot, 'source')
  const persistentContext = fs.mkdtempSync(
    path.join(os.tmpdir(), 'slipway-persistent-source-')
  )
  fs.mkdirSync(ownedContext, { recursive: true })
  fs.writeFileSync(path.join(ownedContext, 'Dockerfile'), 'FROM node:22\n')
  fs.writeFileSync(path.join(persistentContext, 'Dockerfile'), 'FROM node:22\n')

  try {
    const removed = await sails.helpers.deploy.cleanupBuildContext.with({
      contextPath: ownedContext,
      deploymentId
    })
    const preserved = await sails.helpers.deploy.cleanupBuildContext.with({
      contextPath: persistentContext,
      deploymentId
    })

    expect(removed).toEqual({ removed: true })
    expect(preserved).toEqual({ removed: false })
    expect(fs.existsSync(ownedContext)).toBe(false)
    expect(fs.existsSync(persistentContext)).toBe(true)
  } finally {
    fs.rmSync(ownedRoot, { recursive: true, force: true })
    fs.rmSync(persistentContext, { recursive: true, force: true })
  }
})
