const { test } = require('sounding')
const {
  buildPerformanceDiagnostic
} = require('../../../../api/lib/performance-diagnostic')

test('performance packet summarizes measured memory pressure without claiming a leak', async ({
  expect
}) => {
  const diagnostic = buildPerformanceDiagnostic({
    project: 'sailsconf-com',
    environment: 'production',
    containerName: 'slipway-sailsconf-production-588',
    containerType: 'app',
    configuredMemoryLimit: '512m',
    generatedAt: 180000,
    metrics: [
      sample(0, 300, 58.6, 0.04),
      sample(60000, 400, 78.1, 1),
      sample(120000, 468, 91.4, 0.02)
    ]
  })

  expect(diagnostic.observation.sampleCount).toBe(3)
  expect(diagnostic.observation.durationMinutes).toBe(2)
  expect(diagnostic.memory).toEqual({
    latestUsageMiB: 468,
    dockerLimitMiB: 512,
    latestPercent: 91.4,
    firstUsageMiB: 300,
    changeMiB: 168,
    p95Percent: 91.4,
    maxPercent: 91.4
  })
  expect(diagnostic.cpu.latestPercent).toBe(0.02)
  expect(diagnostic.evidenceLimits.join(' ')).toContain(
    'not proof of a memory leak'
  )
  expect(JSON.stringify(diagnostic).includes('envVars')).toBe(false)
})

test('empty performance history exposes missing evidence without invented measurements', async ({
  expect
}) => {
  const diagnostic = buildPerformanceDiagnostic({
    project: 'example',
    environment: 'production',
    containerName: 'missing',
    containerType: 'app',
    metrics: []
  })

  expect(diagnostic.observation.sampleCount).toBe(0)
  expect(diagnostic.memory).toBe(null)
  expect(diagnostic.cpu).toBe(null)
})

function sample(recordedAt, memoryMiB, memoryPercent, cpuPercent) {
  return {
    recordedAt,
    memoryUsage: memoryMiB * 1024 * 1024,
    memoryLimit: 512 * 1024 * 1024,
    memoryPercent,
    cpuPercent
  }
}
