module.exports = {
  friendlyName: 'Get GitHub User',

  description: 'Fetch authenticated GitHub user info.',

  inputs: {
    accessToken: {
      type: 'string',
      required: true
    }
  },

  fn: async function ({ accessToken }) {
    const response = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    })

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`)
    }

    const user = await response.json()

    return {
      id: String(user.id),
      login: user.login,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatar_url
    }
  }
}
