module.exports = {
  friendlyName: 'Create GitHub Webhook',

  description: 'Create a webhook on a GitHub repository.',

  inputs: {
    accessToken: {
      type: 'string',
      required: true
    },
    owner: {
      type: 'string',
      required: true
    },
    repo: {
      type: 'string',
      required: true
    },
    webhookUrl: {
      type: 'string',
      required: true
    },
    secret: {
      type: 'string',
      required: true
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ accessToken, owner, repo, webhookUrl, secret }) {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/hooks`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: 'web',
          active: true,
          events: ['push'],
          config: {
            url: webhookUrl,
            content_type: 'json',
            secret,
            insecure_ssl: '0'
          }
        })
      }
    )

    if (!response.ok) {
      const error = await response.json()

      // If a webhook with this URL already exists, find and reuse it
      if (response.status === 422) {
        const listRes = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/hooks`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28'
            }
          }
        )

        if (listRes.ok) {
          const hooks = await listRes.json()
          const existing = hooks.find((h) => h.config?.url === webhookUrl)
          if (existing) {
            // Update the existing webhook's secret and events
            const updateRes = await fetch(
              `https://api.github.com/repos/${owner}/${repo}/hooks/${existing.id}`,
              {
                method: 'PATCH',
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  Accept: 'application/vnd.github+json',
                  'X-GitHub-Api-Version': '2022-11-28',
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  active: true,
                  events: ['push'],
                  config: {
                    url: webhookUrl,
                    content_type: 'json',
                    secret,
                    insecure_ssl: '0'
                  }
                })
              }
            )

            if (updateRes.ok) {
              const updated = await updateRes.json()
              sails.log.info(
                `[git] Reused existing webhook ${existing.id} on ${owner}/${repo}`
              )
              return {
                id: String(updated.id),
                url: updated.config.url,
                events: updated.events,
                active: updated.active
              }
            }
          }
        }
      }

      throw new Error(`GitHub API error: ${error.message}`)
    }

    const hook = await response.json()

    return {
      id: String(hook.id),
      url: hook.config.url,
      events: hook.events,
      active: hook.active
    }
  }
}
