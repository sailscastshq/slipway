const { test } = require('sounding')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const run = require('node:util').promisify(
  require('node:child_process').execFile
)
test('CLI custom services review server-owned definitions and create only review IDs', async ({
  expect
}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slipway-custom-cli-'))
  const cli = path.resolve('packages/cli/src/index.js')
  fs.mkdirSync(path.join(root, '.slipway'))
  fs.writeFileSync(
    path.join(root, '.slipway/config.json'),
    JSON.stringify({ token: 'fixture', server: 'https://fixture.invalid' })
  )
  fs.writeFileSync(
    path.join(root, '.slipway.json'),
    JSON.stringify({ project: 'custom-project' })
  )
  fs.writeFileSync(
    path.join(root, 'definition.json'),
    JSON.stringify({ env: { TOKEN: 'private-value' }, volumes: ['/data'] })
  )
  const review = {
    id: 'review-token',
    imageReference: 'sha256:exact',
    envKeys: ['TOKEN']
  }
  try {
    for (const create of [false, true]) {
      const runner = path.join(root, 'runner.mjs')
      const args = create
        ? ['service:create', 'review-token']
        : [
            'service:review',
            'example/image:1',
            '--env',
            'staging',
            '--port',
            '8080',
            '--app',
            '42',
            '--definition',
            'definition.json',
            '--json'
          ]
      const expectedBody = create
        ? { reviewId: 'review-token' }
        : {
            definition: {
              env: { TOKEN: 'private-value' },
              volumes: ['/data'],
              image: 'example/image:1',
              port: 8080,
              appIds: ['42']
            }
          }
      const endpoint = create
        ? '/services/custom'
        : '/projects/custom-project/environments/staging/services/custom/review'
      const response = create
        ? {
            service: {
              name: 'image',
              status: 'running',
              customState: { health: 'unverified' }
            }
          }
        : { review }
      fs.writeFileSync(
        runner,
        `import os from 'node:os'; import {syncBuiltinESMExports} from 'node:module'; import assert from 'node:assert/strict'; os.homedir=()=>${JSON.stringify(
          root
        )}; syncBuiltinESMExports(); process.chdir(${JSON.stringify(
          root
        )}); process.argv=['node',${JSON.stringify(cli)},...${JSON.stringify(
          args
        )}]; globalThis.fetch=async(url,options)=>{assert.equal(url,${JSON.stringify(
          'https://fixture.invalid/api/v1' + endpoint
        )}); assert.equal(options.method,'POST'); assert.deepEqual(JSON.parse(options.body),${JSON.stringify(
          expectedBody
        )}); return new Response(JSON.stringify(${JSON.stringify(
          response
        )}));}; await import(${JSON.stringify(cli)});`
      )
      const result = await run(process.execPath, [runner])
      expect(result.stdout.includes('private-value')).toBe(false)
      if (create) expect(result.stdout).toContain('Health: unverified')
      else expect(JSON.parse(result.stdout)).toEqual(review)
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
