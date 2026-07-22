module.exports = {
  friendlyName: 'Read content file',

  description:
    'Read the current Content Manager file from a connected GitHub repository.',

  inputs: {
    environment: {
      type: 'ref',
      required: true
    },
    app: {
      type: 'ref',
      required: true
    },
    filePath: {
      type: 'string',
      required: true
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    },
    notFound: {
      outputType: 'ref'
    },
    unavailable: {
      outputType: 'ref'
    }
  },

  fn: async function ({ environment, app, filePath }) {
    const repository = await findRepository({ environment, app })
    if (!repository) return { mode: 'local' }

    const providerId = normalizeId(repository.provider)
    const provider = providerId
      ? await GitProvider.findOne({ id: providerId }).decrypt()
      : null
    if (!provider || provider.type !== 'github' || !provider.clientSecret) {
      throw {
        unavailable: {
          message:
            'GitHub could not load the latest content. Reconnect the repository and try again.'
        }
      }
    }

    const branch = resolveBranch(repository, environment.slug)
    const encodedPath = filePath
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')
    const url = new URL(
      `https://api.github.com/repos/${encodeURIComponent(
        repository.owner
      )}/${encodeURIComponent(repository.name)}/contents/${encodedPath}`
    )
    url.searchParams.set('ref', branch)

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${provider.clientSecret}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    })

    if (response.status === 404) {
      throw {
        notFound: {
          message: `This content file no longer exists on ${branch}.`
        }
      }
    }

    if (!response.ok) {
      throw {
        unavailable: {
          message:
            'GitHub could not load the latest content. Try again before editing this file.'
        }
      }
    }

    const result = await response.json()
    if (result.type !== 'file' || !result.content || !result.sha) {
      throw {
        unavailable: {
          message: 'GitHub returned an invalid content file response.'
        }
      }
    }

    return {
      mode: 'repository',
      branch,
      content: Buffer.from(
        String(result.content).replace(/\s/g, ''),
        'base64'
      ).toString('utf8'),
      sha: result.sha,
      repository: {
        id: repository.id,
        fullName: repository.fullName,
        htmlUrl: repository.htmlUrl
      }
    }
  }
}

async function findRepository({ environment, app }) {
  let query = GitRepository.findOne({ app: app.id })
  if (query && typeof query.decrypt === 'function') query = query.decrypt()
  const appRepository = await query
  if (appRepository) return appRepository

  query = GitRepository.findOne({ environment: environment.id })
  if (query && typeof query.decrypt === 'function') query = query.decrypt()
  return query
}

function resolveBranch(repository, environmentSlug) {
  const mappings = repository.branchMappings || {}
  const mapped = Object.entries(mappings).find(
    ([, mappedEnvironment]) => mappedEnvironment === environmentSlug
  )
  return mapped?.[0] || repository.defaultBranch || 'main'
}

function normalizeId(value) {
  return value && typeof value === 'object' ? value.id : value
}
