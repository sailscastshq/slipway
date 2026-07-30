const { test } = require('sounding')

test('GitHub webhooks subscribe only to push events', async ({
  sails,
  expect
}) => {
  const originalFetch = global.fetch
  let requestBody

  try {
    global.fetch = async (_url, options) => {
      requestBody = JSON.parse(options.body)
      return {
        ok: true,
        json: async () => ({
          id: 298,
          active: true,
          events: requestBody.events,
          config: { url: requestBody.config.url }
        })
      }
    }

    const webhook = await sails.helpers.git.createGithubWebhook.with({
      accessToken: 'github-token',
      owner: 'sailscastshq',
      repo: 'slipway',
      webhookUrl: 'https://slipway.example/webhook/github',
      secret: 'webhook-secret'
    })

    expect(requestBody.events).toEqual(['push'])
    expect(webhook.events).toEqual(['push'])
  } finally {
    global.fetch = originalFetch
  }
})

test('existing GitHub webhooks are repaired to subscribe only to pushes', async ({
  sails,
  expect
}) => {
  const originalFetch = global.fetch
  const webhookUrl = 'https://slipway.example/webhook/github'
  let updatedBody

  try {
    global.fetch = async (_url, options = {}) => {
      if (options.method === 'POST') {
        return {
          ok: false,
          status: 422,
          json: async () => ({ message: 'Hook already exists' })
        }
      }

      if (!options.method) {
        return {
          ok: true,
          json: async () => [{ id: 298, config: { url: webhookUrl } }]
        }
      }

      updatedBody = JSON.parse(options.body)
      return {
        ok: true,
        json: async () => ({
          id: 298,
          active: true,
          events: updatedBody.events,
          config: { url: webhookUrl }
        })
      }
    }

    const webhook = await sails.helpers.git.createGithubWebhook.with({
      accessToken: 'github-token',
      owner: 'sailscastshq',
      repo: 'slipway',
      webhookUrl,
      secret: 'webhook-secret'
    })

    expect(updatedBody.events).toEqual(['push'])
    expect(webhook.events).toEqual(['push'])
  } finally {
    global.fetch = originalFetch
  }
})
