module.exports = {
  friendlyName: 'Add GitHub Deploy Key',

  description: 'Add a deploy key to a GitHub repository.',

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
    title: {
      type: 'string',
      required: true
    },
    publicKey: {
      type: 'string',
      required: true
    },
    readOnly: {
      type: 'boolean',
      defaultsTo: true
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    },
    keyExists: {
      description: 'A deploy key with this public key already exists'
    }
  },

  fn: async function ({
    accessToken,
    owner,
    repo,
    title,
    publicKey,
    readOnly
  }) {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/keys`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title,
          key: publicKey,
          read_only: readOnly
        })
      }
    )

    if (response.status === 422) {
      // Key already exists
      throw 'keyExists'
    }

    if (!response.ok) {
      const error = await response.json()
      throw new Error(`GitHub API error: ${error.message}`)
    }

    const key = await response.json()

    return {
      id: String(key.id),
      title: key.title,
      readOnly: key.read_only,
      createdAt: key.created_at
    }
  }
}
