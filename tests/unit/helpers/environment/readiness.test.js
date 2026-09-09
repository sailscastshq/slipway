const { test } = require('sounding')
const crypto = require('node:crypto')
const { report } = require('../../../../api/lib/deployment-readiness')
const fingerprint = (value) =>
  crypto
    .createHmac('sha256', 'fixture-key')
    .update(JSON.stringify(value))
    .digest('hex')
function input(files = {}, extra = {}) {
  return {
    source: {
      verified: true,
      revision: 'fixture-source',
      files: new Map(
        Object.entries({
          Dockerfile: 'FROM node:22-alpine\nCMD ["node", "app.js"]',
          'package.json': JSON.stringify({
            dependencies: { sails: '^1.5.0' },
            scripts: { start: 'node app.js' }
          }),
          ...files
        })
      )
    },
    env: {},
    services: [],
    production: true,
    fingerprint,
    ...extra
  }
}
test('readiness distinguishes proven blockers, advisory configuration, and optional capabilities', async ({
  expect
}) => {
  const minimal = report(input())
  expect(minimal.canDeploy).toBe(true)
  expect(minimal.items.find((item) => item.id === 'slipway-hook').status).toBe(
    'not-applicable'
  )
  expect(
    minimal.items
      .find((item) => item.id === 'sessions')
      .fix.includes('Redis is optional')
  ).toBe(true)
  expect(report(input({ Dockerfile: '' })).canDeploy).toBe(false)
  expect(report(input({ Dockerfile: 'FROM node:18-alpine' })).canDeploy).toBe(
    false
  )
  expect(report(input({ Dockerfile: 'FROM node:25-alpine' })).canDeploy).toBe(
    false
  )
  expect(
    report(input({ Dockerfile: 'FROM node:18 AS build\nFROM node:24-alpine' }))
      .canDeploy
  ).toBe(true)
  const external = report(
    input(
      {
        'config/env/production.js':
          "module.exports = { session: {adapter: '@sailshq/connect-redis', url: process.env.REDIS_URL}, datastores: {default: {adapter:'sails-postgresql', url: process.env.DATABASE_URL}} }",
        'package.json': JSON.stringify({
          dependencies: {
            sails: '^1.5.0',
            'sails-hook-slipway': '^1.2.0',
            'sails-hook-quest': '^1.0.0'
          }
        })
      },
      {
        env: {
          SESSION_SECRET: 'secret-must-never-appear',
          DATABASE_URL: 'postgres://private:password@external.test/app',
          REDIS_URL: 'rediss://private:password@cache.test'
        }
      }
    )
  )
  expect(external.items.find((item) => item.id === 'datastore').status).toBe(
    'pass'
  )
  expect(external.items.find((item) => item.id === 'sessions').status).toBe(
    'pass'
  )
  expect(external.items.find((item) => item.id === 'slipway-hook').status).toBe(
    'pass'
  )
  expect(external.items.some((item) => item.id === 'quest')).toBe(true)
  expect(JSON.stringify(external).includes('private')).toBe(false)
  expect(JSON.stringify(external).includes('secret-must-never-appear')).toBe(
    false
  )
  const managed = report(
    input(
      {
        'package.json': JSON.stringify({
          dependencies: { 'sails-postgresql': '^5' }
        })
      },
      { services: [{ id: 'db', type: 'postgresql', status: 'running' }] }
    )
  )
  expect(managed.items.find((item) => item.id === 'datastore').status).toBe(
    'pass'
  )
  const required = {
    'package.json': JSON.stringify({
      slipway: { readiness: { requiredEnv: ['PAYMENT_KEY', 'PORT'] } }
    })
  }
  expect(report(input(required)).canDeploy).toBe(false)
  expect(
    report(input(required, { env: { PAYMENT_KEY: 'configured' } })).canDeploy
  ).toBe(true)
  const prior = report(input())
  const probed = report(
    input(
      {},
      { lastProbe: { version: prior.version, success: true, checkedAt: 123 } }
    )
  )
  expect(probed.items.find((item) => item.id === 'health').status).toBe('pass')
  const stale = report(
    input(
      {},
      {
        env: { OTHER: 'changed' },
        lastProbe: { version: prior.version, success: true, checkedAt: 123 }
      }
    )
  )
  expect(stale.lastProbe.stale).toBe(true)
  expect(stale.items.find((item) => item.id === 'health').status).toBe(
    'warning'
  )
  const failed = report(
    input(
      {},
      { lastProbe: { version: prior.version, success: false, checkedAt: 123 } }
    )
  )
  expect(
    failed.items
      .find((item) => item.id === 'health')
      .evidence.includes('failed')
  ).toBe(true)
  expect(failed.canDeploy).toBe(true) // A fresh candidate probe can retry a transient failure.
})
