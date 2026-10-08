module.exports = {
  friendlyName: 'Check GitHub webhook',
  description:
    'Verify the linked push webhook, optionally repairing it in place.',
  inputs: {
    accessToken: { type: 'string', required: true },
    repository: { type: 'ref', required: true },
    repair: { type: 'boolean', defaultsTo: false }
  },
  exits: { success: { outputType: 'ref' } },
  fn: async function ({ accessToken, repository, repair }) {
    const checkedAt = new Date().toISOString()
    const state = (status, message) => ({ status, message, checkedAt })
    if (
      !repository.webhookId ||
      !repository.webhookUrl ||
      !repository.webhookSecret
    )
      return state(
        'missing',
        'Reconnect this repository to configure its push webhook.'
      )
    const endpoint = `https://api.github.com/repos/${encodeURIComponent(
      repository.owner
    )}/${encodeURIComponent(repository.name)}/hooks/${encodeURIComponent(
      repository.webhookId
    )}`
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json'
    }
    const signal = AbortSignal.timeout(10000)
    const request = async (options = {}) => {
      const response = await fetch(endpoint, { headers, signal, ...options })
      if (!response.ok) {
        const error = new Error('GitHub webhook check failed')
        error.status = response.status
        throw error
      }
      return response.json()
    }
    try {
      let hook = await request()
      if (
        String(hook.id) !== String(repository.webhookId) ||
        hook.config?.url !== repository.webhookUrl
      )
        return state(
          'misconfigured',
          'The linked webhook destination changed. Reconnect this repository to restore it safely.'
        )
      if (repair) {
        await request({
          method: 'PATCH',
          body: JSON.stringify({
            active: true,
            events: ['push'],
            config: {
              url: repository.webhookUrl,
              content_type: 'json',
              secret: repository.webhookSecret,
              insecure_ssl: '0'
            }
          })
        })
        hook = await request()
      }
      if (
        String(hook.id) !== String(repository.webhookId) ||
        hook.config?.url !== repository.webhookUrl ||
        hook.config?.content_type !== 'json' ||
        !hook.events?.includes('push')
      )
        return state(
          'misconfigured',
          'The webhook is not configured for Slipway pushes. Repair auto-deploy or reconnect the repository.'
        )
      if (hook.active !== true)
        return state(
          'inactive',
          'GitHub has disabled this push webhook. Repair auto-deploy to receive future pushes.'
        )
      return state(
        'ready',
        'GitHub push webhook verified. This does not verify end-to-end delivery.'
      )
    } catch (error) {
      if ([401, 403].includes(error.status))
        return state(
          'unverified',
          'Check GitHub credentials and repository Webhooks permissions in Settings → Git, then retry.'
        )
      if (error.status === 404)
        return state(
          'missing',
          'The webhook is missing or inaccessible. Check repository permissions or reconnect it.'
        )
      return state(
        'unverified',
        'Could not verify the GitHub webhook. Retry when GitHub is reachable.'
      )
    }
  }
}
