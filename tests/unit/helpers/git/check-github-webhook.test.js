const { test } = require('sounding')

test('webhook repair checks identity, verifies the provider result and never creates replacement hooks', async ({
  sails,
  expect
}) => {
  const original = global.fetch
  const repository = {
    owner: 'owner',
    name: 'repo',
    webhookId: '738',
    webhookUrl: 'https://slipway.test/webhook/github',
    webhookSecret: 'fixture-secret'
  }
  const calls = []
  let wrongUrl = false
  let active = false
  let ignorePatch = true
  global.fetch = async (_url, options) => {
    calls.push(options.method || 'GET')
    if (options.method === 'PATCH' && !ignorePatch) active = true
    return Response.json({
      id: 738,
      active,
      events: ['push'],
      config: {
        url: wrongUrl ? 'https://unrelated.test' : repository.webhookUrl,
        content_type: 'json'
      }
    })
  }
  const check = (repo = repository) =>
    sails.helpers.git.checkGithubWebhook.with({
      accessToken: 'fixture-token',
      repository: repo,
      repair: true
    })
  try {
    expect((await check()).status).toBe('inactive')
    expect(calls).toEqual(['GET', 'PATCH', 'GET'])
    ignorePatch = false
    expect((await check()).status).toBe('ready')
    wrongUrl = true
    calls.length = 0
    expect((await check()).status).toBe('misconfigured')
    expect(calls).toEqual(['GET'])
    calls.length = 0
    expect((await check({ ...repository, webhookId: null })).status).toBe(
      'missing'
    )
    expect(calls.length).toBe(0)
  } finally {
    global.fetch = original
  }
})
