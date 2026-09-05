const { test } = require('sounding')

test(
  'HTTP CLI session issuance has a bounded per-IP quota',
  { transport: 'http' },
  async ({ post, expect }) => {
    let limited = false
    for (let i = 0; i < 21; i++) {
      const response = await post('/api/v1/cli/auth/init', {
        protocolVersion: 2
      })
      if (response.status === 429 || response.statusCode === 429) {
        expect(response).toHaveStatus(429)
        limited = true
        break
      }
      expect(response).toHaveStatus(200)
    }
    expect(limited).toBe(true)
  }
)
