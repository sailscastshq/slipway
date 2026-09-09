const { createHash } = require('node:crypto')
const repository = require('../../lib/github-repository')

module.exports = {
  friendlyName: 'List GitHub Repos',

  description: 'List repositories accessible to the authenticated user.',

  inputs: {
    accessToken: {
      type: 'string',
      required: true
    },
    page: {
      type: 'number',
      defaultsTo: 1,
      min: 1,
      custom: Number.isSafeInteger
    },
    perPage: {
      type: 'number',
      defaultsTo: 100,
      min: 1,
      max: 100,
      custom: Number.isSafeInteger
    }
  },

  fn: async function ({ accessToken, page, perPage }) {
    // Check cache first
    const scope = createHash('sha256').update(accessToken).digest('hex')
    const cacheKey = `github:repos:v2:${scope}:${page}:${perPage}`
    try {
      const cached = await sails.cache.get(cacheKey)
      if (cached) {
        return cached
      }
    } catch (err) {
      sails.log.verbose('Cache read failed for GitHub repos:', err.message)
    }

    const response = await fetch(
      `https://api.github.com/user/repos?page=${page}&per_page=${perPage}&sort=updated&affiliation=owner,collaborator,organization_member`,
      {
        signal: AbortSignal.timeout(15000),
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      }
    )

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`)
    }

    const repos = await response.json()

    const result = {
      repos: repos.map(repository),
      hasMore: /<[^>]+>;\s*rel="next"/.test(response.headers.get('link') || '')
    }

    // Cache successful response for 5 minutes
    try {
      await sails.cache.set(cacheKey, result, 300_000)
    } catch (err) {
      /* best-effort */
    }

    return result
  }
}
