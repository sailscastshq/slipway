module.exports = {
  friendlyName: 'List GitHub Branches',

  description: 'List branches for a specific GitHub repository.',

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
    }
  },

  fn: async function ({ accessToken, owner, repo }) {
    const cacheKey = `github:branches:${owner}/${repo}`
    try {
      const cached = await sails.cache.get(cacheKey)
      if (cached) { return cached }
    } catch (err) {
      sails.log.verbose('Cache read failed for GitHub branches:', err.message)
    }

    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/branches?per_page=100`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      }
    )

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`)
    }

    const branches = await response.json()

    const result = branches.map(branch => ({
      name: branch.name,
      isProtected: branch.protected
    }))

    // Cache for 2 minutes
    try { await sails.cache.set(cacheKey, result, 120_000) } catch (err) { /* best-effort */ }

    return result
  }
}
