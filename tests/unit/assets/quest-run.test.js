const { test } = require('sounding')

const receipt = (body) => ({ ok: true, json: async () => body })

test('Quest request results preserve exit-zero stderr without inferring business outcomes', async ({
  expect
}) => {
  const { requestQuestRun } = await import(
    '../../../assets/js/lib/questRun.mjs'
  )
  const result = await requestQuestRun('/synthetic', async (url, options) => {
    expect(url).toBe('/synthetic')
    expect(options.method).toBe('POST')
    return receipt({
      success: true,
      exitCode: 0,
      output: '{"success":false,"processed":0}',
      stderr: 'Synthetic warning'
    })
  })
  expect(result).toEqual({
    state: 'completed',
    success: true,
    exitCode: 0,
    stdout: '{"success":false,"processed":0}',
    stderr: 'Synthetic warning',
    error: ''
  })
  const legacy = await requestQuestRun('/synthetic', async () =>
    receipt({ success: true, exitCode: 0, error: 'Legacy stderr warning' })
  )
  expect(legacy.stderr).toBe('Legacy stderr warning')
  expect(legacy.state).toBe('completed')
  const failed = await requestQuestRun('/synthetic', async () =>
    receipt({ success: false, exitCode: 7, error: 'Synthetic error' })
  )
  expect(failed.state).toBe('failed')
  expect(failed.exitCode).toBe(7)
})

test('Quest HTTP rejections never become process results even with a misleading JSON body', async ({
  expect
}) => {
  const { requestQuestRun } = await import(
    '../../../assets/js/lib/questRun.mjs'
  )
  for (const status of [400, 401, 403, 404, 419, 500, 502]) {
    let parsed = false
    const result = await requestQuestRun('/synthetic', async () => ({
      ok: false,
      status,
      json: async () => {
        parsed = true
        return { success: true, exitCode: 0 }
      }
    }))
    expect(result.state).toBe('request_failed')
    expect(result.exitCode).toBe(null)
    expect(result.error).toContain(`HTTP ${status}`)
    expect(parsed).toBe(false)
  }
})

test('Quest disconnects, invalid bodies, missing exit codes, and contradictory receipts stay unconfirmed', async ({
  expect
}) => {
  const { requestQuestRun } = await import(
    '../../../assets/js/lib/questRun.mjs'
  )
  const responses = [
    async () => {
      throw new Error('network disconnected')
    },
    async () => ({
      ok: true,
      json: async () => {
        throw new Error('HTML instead of JSON')
      }
    }),
    ...[
      null,
      {},
      { success: false, exitCode: null },
      { success: true, exitCode: 1 },
      { success: false, exitCode: 0 },
      { success: false, exitCode: -1 },
      { success: true, exitCode: '0' }
    ].map((body) => async () => receipt(body))
  ]
  for (const response of responses) {
    const result = await requestQuestRun('/synthetic', response)
    expect(result.state).toBe('unconfirmed')
    expect(result.exitCode).toBe(null)
    expect(result.error).toContain('Check history before retrying')
    expect('runId' in result).toBe(false)
  }
  const interrupted = await requestQuestRun('/synthetic', async () =>
    receipt({
      success: false,
      exitCode: null,
      output: 'partial output',
      stderr: 'partial diagnostic'
    })
  )
  expect(interrupted.stdout).toBe('partial output')
  expect(interrupted.stderr).toBe('partial diagnostic')
})
