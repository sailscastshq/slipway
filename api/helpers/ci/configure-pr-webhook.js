const github = require('../../lib/ci-github')
module.exports = {
  friendlyName: 'Enable reviewed pull request delivery',
  inputs: { app: { type: 'ref', required: true } },
  fn: async function ({ app }) {
    const { repository, request } = await github.connection(app)
    if (
      !repository.webhookId ||
      !repository.webhookSecret ||
      !repository.webhookUrl
    )
      throw new Error(
        'Connect and verify the repository webhook before enabling PR checks.'
      )
    const suffix = '/hooks/' + encodeURIComponent(repository.webhookId)
    const hook = await request(suffix)
    if (
      String(hook.id) !== String(repository.webhookId) ||
      hook.config?.url !== repository.webhookUrl ||
      hook.config?.content_type !== 'json' ||
      hook.config?.insecure_ssl === '1'
    ) {
      throw new Error(
        'The connected webhook destination or signature configuration needs review.'
      )
    }
    if (!hook.events?.includes('pull_request') || hook.active !== true) {
      await request(suffix, {
        method: 'PATCH',
        body: {
          active: true,
          events: [...new Set([...(hook.events || []), 'push', 'pull_request'])]
        }
      })
    }
    const verified = await request(suffix)
    if (
      verified.active !== true ||
      !verified.events?.includes('pull_request') ||
      verified.config?.url !== repository.webhookUrl
    ) {
      throw new Error(
        'GitHub did not confirm pull request webhook delivery configuration.'
      )
    }
    return { configured: true }
  }
}
