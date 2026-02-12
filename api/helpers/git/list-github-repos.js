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
      defaultsTo: 1
    },
    perPage: {
      type: 'number',
      defaultsTo: 30
    }
  },

  fn: async function ({ accessToken, page, perPage }) {
    const response = await fetch(
      `https://api.github.com/user/repos?page=${page}&per_page=${perPage}&sort=updated&affiliation=owner,collaborator,organization_member`,
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

    const repos = await response.json()

    return repos.map(repo => ({
      id: String(repo.id),
      name: repo.name,
      fullName: repo.full_name,
      owner: repo.owner.login,
      htmlUrl: repo.html_url,
      cloneUrl: repo.ssh_url,
      defaultBranch: repo.default_branch,
      isPrivate: repo.private,
      description: repo.description,
      language: repo.language,
      updatedAt: repo.updated_at
    }))
  }
}
