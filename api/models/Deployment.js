const { appendTimestampedChunk } = require('../lib/deployment-log')

const logAppendQueues = new Map()

/**
 * Deployment.js
 *
 * Represents a single deployment attempt within an environment.
 * Tracks build logs, status, and deployment metadata.
 */

module.exports = {
  tableName: 'deployments',

  attributes: {
    status: {
      type: 'string',
      isIn: [
        'pending',
        'building',
        'pushing',
        'deploying',
        'running',
        'stopped',
        'failed',
        'cancelled'
      ],
      defaultsTo: 'pending',
      description: 'Current deployment status'
    },

    // Source information
    gitCommit: {
      type: 'string',
      allowNull: true,
      description: 'Git commit SHA',
      columnName: 'git_commit'
    },

    gitBranch: {
      type: 'string',
      allowNull: true,
      description: 'Git branch name',
      columnName: 'git_branch'
    },

    gitMessage: {
      type: 'string',
      allowNull: true,
      description: 'Git commit message',
      columnName: 'git_message'
    },

    // Build information
    imageId: {
      type: 'string',
      allowNull: true,
      description: 'Built Docker image ID',
      columnName: 'image_id'
    },

    imageName: {
      type: 'string',
      allowNull: true,
      description: 'Built Docker image name:tag',
      columnName: 'image_name'
    },

    // Logs
    buildLogs: {
      type: 'string',
      allowNull: true,
      columnType: 'text',
      description: 'Docker build output',
      columnName: 'build_logs'
    },

    deployLogs: {
      type: 'string',
      allowNull: true,
      columnType: 'text',
      description: 'Deployment output',
      columnName: 'deploy_logs'
    },

    errorMessage: {
      type: 'string',
      allowNull: true,
      description: 'Error message if deployment failed',
      columnName: 'error_message'
    },

    configHash: {
      type: 'string',
      allowNull: true,
      description:
        'Keyed SHA-256 fingerprint of the resolved runtime configuration',
      columnName: 'config_hash'
    },

    configManifest: {
      type: 'json',
      defaultsTo: [],
      description:
        'Non-secret manifest describing the source and policy of deployed variables',
      columnName: 'config_manifest'
    },

    // Timing
    startedAt: {
      type: 'number',
      allowNull: true,
      description: 'Timestamp when deployment started',
      columnName: 'started_at'
    },

    finishedAt: {
      type: 'number',
      allowNull: true,
      description: 'Timestamp when deployment finished',
      columnName: 'finished_at'
    },

    // Who triggered it
    triggeredBy: {
      model: 'user',
      description: 'User who triggered the deployment',
      columnName: 'triggered_by'
    },

    triggerType: {
      type: 'string',
      isIn: ['manual', 'cli', 'webhook', 'api', 'content'],
      defaultsTo: 'manual',
      description: 'How the deployment was triggered',
      columnName: 'trigger_type'
    },

    // Associations
    environment: {
      model: 'environment',
      required: true
    },

    app: {
      model: 'app',
      description: 'Target app (null for legacy deployments)'
    }
  },

  /**
   * Get deployment duration in seconds
   */
  getDuration: function (deployment) {
    if (!deployment.startedAt) return null
    const end = deployment.finishedAt || Date.now()
    return Math.round((end - deployment.startedAt) / 1000)
  },

  /**
   * Append to build logs
   */
  appendBuildLog: async function (deploymentId, log) {
    return appendLog(deploymentId, 'buildLogs', log)
  },

  /**
   * Append to deploy logs
   */
  appendDeployLog: async function (deploymentId, log) {
    return appendLog(deploymentId, 'deployLogs', log)
  }
}

async function appendLog(deploymentId, field, log) {
  if (!log) return

  const key = `${deploymentId}:${field}`
  const occurredAt = new Date().toISOString()
  const previous = logAppendQueues.get(key) || Promise.resolve()
  const pending = previous
    .catch(() => {})
    .then(async () => {
      const deployment = await Deployment.findOne({ id: deploymentId })
      if (!deployment) return

      await Deployment.updateOne({ id: deploymentId }).set({
        [field]: appendTimestampedChunk(deployment[field], log, occurredAt)
      })
    })

  logAppendQueues.set(key, pending)
  try {
    await pending
  } finally {
    if (logAppendQueues.get(key) === pending) logAppendQueues.delete(key)
  }
}
