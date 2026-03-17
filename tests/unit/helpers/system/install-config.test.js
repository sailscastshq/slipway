const fs = require('node:fs')
const path = require('node:path')

const { test } = require('sounding')

const appRoot = path.resolve(__dirname, '../../../../')

test('dashboard install excludes the published hook workspace', async ({
  expect
}) => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8')
  )
  const npmrc = fs.readFileSync(path.join(appRoot, '.npmrc'), 'utf8')

  expect(packageJson.dependencies?.['sails-hook-slipway']).toBe(undefined)
  expect(packageJson.devDependencies?.['sails-hook-slipway']).toBe(undefined)
  expect(npmrc.includes('workspaces=false')).toBe(true)
})
