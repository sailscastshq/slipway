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
      isIn: ['pending', 'building', 'pushing', 'deploying', 'running', 'stopped', 'failed', 'cancelled'],
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
      isIn: ['manual', 'cli', 'webhook', 'api'],
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
    const deployment = await Deployment.findOne({ id: deploymentId })
    if (!deployment) return

    const currentLogs = deployment.buildLogs || ''
    await Deployment.updateOne({ id: deploymentId }).set({
      buildLogs: currentLogs + log
    })
  },

  /**
   * Append to deploy logs
   */
  appendDeployLog: async function (deploymentId, log) {
    const deployment = await Deployment.findOne({ id: deploymentId })
    if (!deployment) return

    const currentLogs = deployment.deployLogs || ''
    await Deployment.updateOne({ id: deploymentId }).set({
      deployLogs: currentLogs + log
    })
  }
}
