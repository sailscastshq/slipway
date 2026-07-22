const { withContentCommitTrailer } = require('../../lib/content-commit')

module.exports = {
  friendlyName: 'Commit content file',

  description:
    'Commit a Content Manager file to its connected GitHub repository with optimistic conflict protection.',

  inputs: {
    environment: {
      type: 'ref',
      required: true
    },
    app: {
      type: 'ref',
      required: true
    },
    user: {
      type: 'ref',
      required: true
    },
    filePath: {
      type: 'string',
      required: true,
      description: 'Repository-relative content file path.'
    },
    content: {
      type: 'string',
      description: 'Complete replacement file contents.'
    },
    operation: {
      type: 'string',
      isIn: ['create', 'update', 'delete'],
      defaultsTo: 'update'
    },
    expectedSha: {
      type: 'string',
      description: 'Blob SHA loaded by the editor.'
    },
    message: {
      type: 'string',
      required: true
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    },
    conflict: {
      description: 'The repository file changed after the editor loaded it.',
      outputType: 'ref'
    },
    writeUnavailable: {
      description: 'The connected repository cannot be written.',
      outputType: 'ref'
    }
  },

  fn: async function ({
    environment,
    app,
    user,
    filePath,
    content,
    operation,
    expectedSha,
    message
  }) {
    const repository = await findRepository({ environment, app })
    if (!repository) {
      return { mode: 'local' }
    }

    const providerId = normalizeId(repository.provider)
    const provider = providerId
      ? await GitProvider.findOne({ id: providerId }).decrypt()
      : null

    if (!provider || provider.type !== 'github' || !provider.clientSecret) {
      throw {
        writeUnavailable: {
          message:
            'The connected repository cannot accept Content Manager changes. Reconnect GitHub and try again.'
        }
      }
    }

    if (operation !== 'create' && !expectedSha) {
      throw {
        conflict: {
          message:
            'The editor does not have a repository revision for this file. Reload it before saving.'
        }
      }
    }

    const branch = resolveBranch(repository, environment.slug)
    const encodedPath = filePath
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')
    const url = `https://api.github.com/repos/${encodeURIComponent(
      repository.owner
    )}/${encodeURIComponent(repository.name)}/contents/${encodedPath}`
    const body = {
      message: withContentCommitTrailer(message),
      branch,
      author: {
        name: user.fullName,
        email: user.email
      }
    }
    if (operation === 'delete') {
      body.sha = expectedSha
    } else {
      body.content = Buffer.from(content || '', 'utf8').toString('base64')
      if (expectedSha) body.sha = expectedSha
    }

    const response = await fetch(url, {
      method: operation === 'delete' ? 'DELETE' : 'PUT',
      headers: {
        Authorization: `Bearer ${provider.clientSecret}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })

    if (response.status === 409 || response.status === 422) {
      throw {
        conflict: {
          message:
            'This file changed in Git while you were editing it. Reload the latest version before saving.'
        }
      }
    }

    if (response.status === 401 || response.status === 403) {
      throw {
        writeUnavailable: {
          message:
            'GitHub rejected this content commit. Reconnect GitHub with repository write access and try again.'
        }
      }
    }

    if (!response.ok) {
      let detail = ''
      try {
        const error = await response.json()
        detail = error.message ? ` ${error.message}` : ''
      } catch {
        /* GitHub did not return JSON. */
      }

      throw {
        writeUnavailable: {
          message: `GitHub could not save this content.${detail}`
        }
      }
    }

    const result = await response.json()
    return {
      mode: 'repository',
      branch,
      commitSha: result.commit?.sha || null,
      contentSha: result.content?.sha || null,
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
