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
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ project, environment, app, deploymentId, gitBranch }) {
    const contextPath = path.join(sails.config.custom.slipwayAppsDir, project.slug)

    if (fs.existsSync(contextPath)) {
      return {
        contextPath,
        hydrated: false
      }
    }

    const repo = await findConnectedRepository(app, environment)
    if (repo && repo.cloneUrl && repo.deployKeyPrivate) {
      const branch = resolveDeployBranch(repo, environment.slug, gitBranch)

      await appendBuildLog(
        deploymentId,
        `Build context missing at ${contextPath}. Syncing source from ${
          repo.fullName || repo.cloneUrl
        } (${branch})...\n`
      )

      try {
        await sails.helpers.git.cloneOrPull.with({
          cloneUrl: repo.cloneUrl,
          branch,
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

      if (fs.existsSync(contextPath)) {
        return {
          contextPath,
          hydrated: true,
          branch
        }
      }
    }

    const guidance = repo
      ? 'A repository is connected, but Slipway could not use it to restore source. Reconnect the repository or push source before deploying.'
      : 'Push source to Slipway or connect a repository before deploying.'
    const errorMessage = `Build context missing at ${contextPath}. ${guidance}`

    await appendBuildLog(deploymentId, `${errorMessage}\n`)
    throw new Error(errorMessage)
  }
}

module.exports._private = {
  resolveDeployBranch,
  findConnectedRepository
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
