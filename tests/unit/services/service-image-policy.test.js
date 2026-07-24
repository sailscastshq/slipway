const { test } = require('sounding')

const {
  getPublicMatrix,
  getUpgradePlan,
  inspectVersion
} = require('../../../api/lib/service-image-policy')

test('fresh services use tested numeric defaults instead of mutable tags', ({
  expect
}) => {
  expect(inspectVersion('postgresql').version).toBe('17')
  expect(inspectVersion('mysql').version).toBe('8.4')
  expect(inspectVersion('redis').version).toBe('7.2')
  expect(inspectVersion('mongodb').version).toBe('8.0')

  for (const policy of Object.values(getPublicMatrix())) {
    expect(policy.defaultVersion === 'latest').toBe(false)
    expect(
      policy.versions.some(({ version }) => version === policy.defaultVersion)
    ).toBe(true)
  }
})

test('service image policy rejects mutable and unsafe Docker tags', ({
  expect
}) => {
  expect(
    captureError(() => inspectVersion('postgresql', 'latest')).message
  ).toContain('mutable "latest" tag is not allowed')
  expect(
    captureError(() => inspectVersion('postgresql', '17-alpine')).message
  ).toContain('Versions must be numeric Docker tags')
  expect(
    captureError(() => inspectVersion('postgresql', '17;docker pull evil'))
      .message
  ).toContain('Versions must be numeric Docker tags')
})

test('custom numeric tags are explicit and supported upgrades cannot skip lines', ({
  expect
}) => {
  const custom = inspectVersion('postgresql', '17.4')
  expect(custom.supported).toBe(false)
  expect(custom.imageTag).toBe('postgres:17.4')

  const upgrade = getUpgradePlan('postgresql', '16', '17')
  expect(upgrade.requiresBackup).toBe(true)
  expect(upgrade.fromVersion).toBe('16')
  expect(upgrade.toVersion).toBe('17')

  expect(
    captureError(() => getUpgradePlan('postgresql', '15', '17')).message
  ).toContain('cannot automate an upgrade from unsupported')
  expect(
    captureError(() => getUpgradePlan('redis', '7.2', '8')).message
  ).toContain("not in Slipway's tested upgrade matrix")
})

function captureError(fn) {
  try {
    fn()
  } catch (error) {
    return error
  }

  throw new Error('Expected operation to fail.')
}
