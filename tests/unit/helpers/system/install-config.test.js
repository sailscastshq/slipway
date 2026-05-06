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

test('installer validates the target image before replacing the live dashboard', async ({
  expect
}) => {
  const script = fs.readFileSync(path.join(appRoot, 'install.sh'), 'utf8')

  expect(
    script.includes(
      'SLIPWAY_VALIDATION_CONTAINER="${SLIPWAY_VALIDATION_CONTAINER:-slipway-next}"'
    )
  ).toBe(true)
  expect(
    script.includes(
      'SLIPWAY_PREVIOUS_CONTAINER="${SLIPWAY_PREVIOUS_CONTAINER:-slipway-previous}"'
    )
  ).toBe(true)
  expect(script.includes('validate_slipway_image()')).toBe(true)
  expect(
    script.includes('run_slipway_container "$SLIPWAY_VALIDATION_CONTAINER"')
  ).toBe(true)
  expect(
    script.includes(
      'docker exec "$container_name" curl -fsS http://localhost:1337/health'
    )
  ).toBe(true)
  expect(script.includes('replace_live_container()')).toBe(true)
  expect(script.includes('docker container inspect "$1"')).toBe(true)
  expect(
    script.includes(
      'docker rename "$SLIPWAY_CONTAINER" "$SLIPWAY_PREVIOUS_CONTAINER"'
    )
  ).toBe(true)
  expect(
    script.includes(
      'docker rename "$SLIPWAY_PREVIOUS_CONTAINER" "$SLIPWAY_CONTAINER"'
    )
  ).toBe(true)
  expect(script.includes('docker logs --tail 200 "$container_name"')).toBe(true)
  expect(
    script.indexOf('# 8. Prepare the database') <
      script.indexOf('# 9. Validate target image')
  ).toBe(true)
  expect(
    script.indexOf('# 9. Validate target image') <
      script.indexOf('# 10. Replace the live dashboard')
  ).toBe(true)
})

test('installer keeps production defaults overridable for isolated rehearsals', async ({
  expect
}) => {
  const script = fs.readFileSync(path.join(appRoot, 'install.sh'), 'utf8')

  expect(
    script.includes('SLIPWAY_ENV_FILE="${SLIPWAY_ENV_FILE:-/etc/slipway/.env}"')
  ).toBe(true)
  expect(
    script.includes('SLIPWAY_APPS_DIR="${SLIPWAY_APPS_DIR:-/var/slipway/apps}"')
  ).toBe(true)
  expect(
    script.includes('SLIPWAY_CONTAINER="${SLIPWAY_CONTAINER:-slipway}"')
  ).toBe(true)
  expect(
    script.includes(
      'SLIPWAY_PROXY_CONTAINER="${SLIPWAY_PROXY_CONTAINER:-slipway-proxy}"'
    )
  ).toBe(true)
  expect(script.includes('SLIPWAY_NETWORK="${SLIPWAY_NETWORK:-slipway}"')).toBe(
    true
  )
  expect(
    script.includes('SLIPWAY_DB_VOLUME="${SLIPWAY_DB_VOLUME:-slipway-db}"')
  ).toBe(true)
  expect(script.includes('SLIPWAY_PORT="${SLIPWAY_PORT:-1337}"')).toBe(true)
  expect(
    script.includes('SLIPWAY_HEALTH_ATTEMPTS="${SLIPWAY_HEALTH_ATTEMPTS:-30}"')
  ).toBe(true)
  expect(
    script.includes('SLIPWAY_SKIP_PULL="${SLIPWAY_SKIP_PULL:-false}"')
  ).toBe(true)
  expect(script.includes('if [ "$SLIPWAY_SKIP_PULL" = true ]; then')).toBe(true)
  expect(script.includes('docker network create "$SLIPWAY_NETWORK"')).toBe(true)
  expect(script.includes('-v "$SLIPWAY_DB_VOLUME:/app/db"')).toBe(true)
  expect(script.includes('-p "$SLIPWAY_HTTP_PORT:80"')).toBe(true)
  expect(script.includes('-p "$SLIPWAY_HTTPS_PORT:443"')).toBe(true)
})
