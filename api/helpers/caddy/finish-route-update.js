const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)

module.exports = {
  friendlyName: 'Finish route update',

  description:
    'Commit or roll back a verified Caddy route candidate without discarding the previous route prematurely.',

  inputs: {
    action: {
      type: 'string',
      required: true,
      isIn: ['commit', 'rollback']
    },
    transaction: {
      type: 'ref',
      required: true
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ action, transaction }) {
    if (action === 'rollback') {
      await rollbackRoute(transaction)
      return { action: 'rolled_back', routeId: transaction.routeId }
    }

    try {
      await commitRoute(transaction)
      return { action: 'committed', routeId: transaction.routeId }
    } catch (error) {
      try {
        await rollbackRoute(transaction)
      } catch (rollbackError) {
        error.rollbackError = rollbackError
      }
      throw error
    }
  }
}

async function commitRoute(transaction) {
  const dockerPath = sails.config.docker?.binaryPath || 'docker'
  const retiredUpstreams = difference(
    transaction.previousUpstreams,
    transaction.candidateUpstreams
  )

  if (transaction.previousExists) {
    if (transaction.previousWasRunning) {
      await execFileAsync(dockerPath, ['stop', transaction.routeId])
      await sails.helpers.caddy.verifyRoute.with({
        expectedUpstreams: transaction.candidateUpstreams,
        excludedUpstreams: retiredUpstreams
      })
    }
    await execFileAsync(dockerPath, [
      'rename',
      transaction.routeId,
      transaction.previousRouteId
    ])
  }

  await execFileAsync(dockerPath, [
    'rename',
    transaction.candidateRouteId,
    transaction.routeId
  ])

  if (transaction.previousExists) {
    await tolerateDockerError(dockerPath, [
      'rm',
      '-f',
      transaction.previousRouteId
    ])
  }
}

async function rollbackRoute(transaction) {
  const dockerPath = sails.config.docker?.binaryPath || 'docker'
  const candidateOnlyUpstreams = difference(
    transaction.candidateUpstreams,
    transaction.previousUpstreams
  )
  const previousState = await getContainerState(
    dockerPath,
    transaction.previousRouteId
  )

  if (previousState.exists) {
    await tolerateDockerError(dockerPath, ['rm', '-f', transaction.routeId])
    await tolerateDockerError(dockerPath, [
      'rm',
      '-f',
      transaction.candidateRouteId
    ])
    await execFileAsync(dockerPath, [
      'rename',
      transaction.previousRouteId,
      transaction.routeId
    ])
  } else {
    await tolerateDockerError(dockerPath, [
      'rm',
      '-f',
      transaction.candidateRouteId
    ])
    if (!transaction.previousExists) {
      await tolerateDockerError(dockerPath, ['rm', '-f', transaction.routeId])
    }
  }

  if (transaction.previousExists && transaction.previousWasRunning) {
    const routeState = await getContainerState(dockerPath, transaction.routeId)
    if (!routeState.running) {
      await execFileAsync(dockerPath, ['start', transaction.routeId])
    }
    if (transaction.previousUpstreams.length > 0) {
      await sails.helpers.caddy.verifyRoute.with({
        expectedUpstreams: transaction.previousUpstreams,
        excludedUpstreams: candidateOnlyUpstreams
      })
    }
  } else if (!transaction.previousExists) {
    await sails.helpers.caddy.verifyRoute.with({
      expectedUpstreams: [],
      excludedUpstreams: candidateOnlyUpstreams
    })
  }
}

function difference(values, excludedValues) {
  const excluded = new Set(excludedValues)
  return values.filter((value) => !excluded.has(value))
}

async function getContainerState(dockerPath, containerName) {
  try {
    const { stdout } = await execFileAsync(dockerPath, [
      'inspect',
      '--format',
      '{{.State.Running}}',
      containerName
    ])
    return { exists: true, running: stdout.trim() === 'true' }
  } catch {
    return { exists: false, running: false }
  }
}

async function tolerateDockerError(dockerPath, args) {
  try {
    await execFileAsync(dockerPath, args)
  } catch {
    // Cleanup is intentionally idempotent.
  }
}

module.exports._private = { commitRoute, difference, rollbackRoute }
