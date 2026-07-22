const fs = require('fs')
const path = require('path')

module.exports = {
  friendlyName: 'Ensure build context',

  description:
    'Ensure a deployable source tree exists for a project before Docker build runs.',

  inputs: {
    project: {
      type: 'ref',
      required: true
    },
    environment: {
      type: 'ref',
      required: true
    },
    app: {
      type: 'ref'
    },
    deploymentId: {
      type: 'string'
    },
    gitBranch: {
      type: 'string'
    },
    gitCommit: {
      type: 'string',
      description: 'Exact repository commit to build when one was recorded.'
    },
    refreshRepository: {
      type: 'boolean',
      defaultsTo: false,
      description:
        'Sync a connected repository even when a local source cache already exists.'
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({
    project,
    environment,
    app,
    deploymentId,
    gitBranch,
    gitCommit,
    refreshRepository
  }) {
    const readiness = await inspectBuildContext({
      project,
      environment,
      app
    })
    const { contextPath, repository: repo } = readiness

    if (readiness.hasSource && (!refreshRepository || !readiness.canHydrate)) {
      return {
        contextPath,
        hydrated: false,
        sourceMode: readiness.sourceMode
      }
    }

    if (readiness.canHydrate) {
      const branch = resolveDeployBranch(repo, environment.slug, gitBranch)
      const sourceState = readiness.hasSource
        ? `Refreshing source from ${repo.fullName || repo.cloneUrl}`
        : `Build context missing at ${contextPath}. Syncing source from ${
            repo.fullName || repo.cloneUrl
          }`

      await appendBuildLog(deploymentId, `${sourceState} (${branch})...\n`)

      try {
        await sails.helpers.git.cloneOrPull.with({
          cloneUrl: repo.cloneUrl,
          branch,
          ...(gitCommit ? { commit: gitCommit } : {}),
          targetDir: contextPath,
          deployKeyPrivate: repo.deployKeyPrivate,
          deploymentId
        })
      } catch (err) {
        const errorMessage = `Source sync failed for ${project.slug}: ${
          err.message || err
        }`
        await appendBuildLog(deploymentId, `${errorMessage}\n`)
        throw new Error(errorMessage)
      }

      if (hasSourceFiles(contextPath)) {
        return {
          contextPath,
          hydrated: true,
          branch,
          sourceMode: 'repository'
        }
      }
    }

    const guidance = readiness.hasConnectedRepository
      ? 'A repository is connected, but Slipway could not use it to restore source. Reconnect the repository or push source before deploying.'
      : 'Push source to Slipway or connect a repository before deploying.'
    const errorMessage = `Build context missing at ${contextPath}. ${guidance}`

    await appendBuildLog(deploymentId, `${errorMessage}\n`)
    throw new Error(errorMessage)
  }
}

module.exports._private = {
  resolveDeployBranch,
  findConnectedRepository,
  hasSourceFiles,
  inspectBuildContext
}

async function inspectBuildContext({ project, environment, app }) {
  const contextPath = path.join(
    sails.config.custom.slipwayAppsDir,
    project.slug
  )
  const hasSource = hasSourceFiles(contextPath)
  const repository = await findConnectedRepository(app, environment)
  const hasConnectedRepository = Boolean(repository)
  const canHydrate = Boolean(
    repository && repository.cloneUrl && repository.deployKeyPrivate
  )

  let sourceMode = 'none'
  if (canHydrate) {
    sourceMode = 'repository'
  } else if (hasSource) {
    sourceMode = 'pushed'
  }

  return {
    contextPath,
    hasSource,
    repository,
    hasConnectedRepository,
    canHydrate,
    available: hasSource || canHydrate,
    sourceMode
  }
}

function hasSourceFiles(contextPath) {
  try {
    if (!fs.statSync(contextPath).isDirectory()) return false
    return fs
      .readdirSync(contextPath)
      .some((entry) => entry !== '.git' && entry !== '.DS_Store')
  } catch {
    return false
  }
}

async function appendBuildLog(deploymentId, message) {
  if (!deploymentId) return

  try {
    await Deployment.appendBuildLog(deploymentId, message)
  } catch {
    /* best-effort */
  }
}

async function findConnectedRepository(app, environment) {
  if (app && app.id) {
    const appRepo = await findOneDecrypted({ app: app.id })
    if (appRepo) {
      return appRepo
    }
  }

  if (environment && environment.id) {
    return findOneDecrypted({ environment: environment.id })
  }

  return null
}

async function findOneDecrypted(criteria) {
  const query = GitRepository.findOne(criteria)

  if (query && typeof query.decrypt === 'function') {
    return query.decrypt()
  }

  return query
}

function resolveDeployBranch(repo, environmentSlug, gitBranch) {
  if (gitBranch) {
    return gitBranch
  }

  if (repo?.branchMappings && typeof repo.branchMappings === 'object') {
    for (const [branch, mappedEnvironmentSlug] of Object.entries(
      repo.branchMappings
    )) {
      if (mappedEnvironmentSlug === environmentSlug) {
        return branch
      }
    }

    const firstMappedBranch = Object.keys(repo.branchMappings)[0]
    if (firstMappedBranch) {
      return firstMappedBranch
    }
  }

  return repo?.defaultBranch || 'main'
}
