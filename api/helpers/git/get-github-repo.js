const repository = require('../../lib/github-repository')

module.exports = {
  friendlyName: 'Get GitHub repo',
  description:
    'Resolve a repository by ID with the current GitHub credentials.',
  inputs: {
    accessToken: { type: 'string', required: true },
    repoId: { type: 'string', required: true, regex: /^[1-9][0-9]*$/ }
  },
  fn: async function ({ accessToken, repoId }) {
    // Always reauthorize selection, independently of the cached picker pages.
    const response = await fetch(
      `https://api.github.com/repositories/${repoId}`,
      {
        signal: AbortSignal.timeout(15000),
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      }
    )
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`GitHub API error: ${response.status}`)
    const repo = await response.json()
    if (String(repo.id) !== repoId)
      throw new Error('GitHub repository ID mismatch')
    return repository(repo)
  }
}
