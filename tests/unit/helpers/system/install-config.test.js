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

test('installer pulls and runs the resolved Slipway image ref', async ({
  expect
}) => {
  const script = fs.readFileSync(path.join(appRoot, 'install.sh'), 'utf8')

  expect(script.includes('SLIPWAY_VERSION="${SLIPWAY_VERSION:-${1:-}}"')).toBe(
    true
  )
  expect(
    script.includes(
      'SLIPWAY_IMAGE="$SLIPWAY_IMAGE_REPOSITORY:$SLIPWAY_VERSION"'
    )
  ).toBe(true)
  expect(script.includes('docker pull "$SLIPWAY_IMAGE"')).toBe(true)
  expect(script.includes('ghcr.io/sailscastshq/slipway:latest')).toBe(false)
})
