/**
 * DeploymentJob.js
 *
 * Durable execution state for a deployment or rollback pipeline.
 */

module.exports = {
  tableName: 'deployment_jobs',

  attributes: {
    deployment: {
      model: 'deployment',
      required: true,
      unique: true,
      columnName: 'deployment_id'
    },

    targetKey: {
      type: 'string',
      required: true,
      description: 'Environment key whose pipelines must be serialized.',
      columnName: 'target_key'
    },

    appSlug: {
      type: 'string',
      defaultsTo: 'app',
      columnName: 'app_slug'
    },

    kind: {
      type: 'string',
      isIn: ['deploy', 'rollback'],
      defaultsTo: 'deploy'
    },

    targetDeploymentId: {
      type: 'number',
      allowNull: true,
      description: 'Existing deployment image used by a rollback job.',
      columnName: 'target_deployment_id'
    },

    stage: {
      type: 'string',
      defaultsTo: 'queued'
    },

    attempt: {
      type: 'number',
      defaultsTo: 0
    },

    candidateContainerName: {
      type: 'string',
      allowNull: true,
      columnName: 'candidate_container_name'
    },

    previousContainerName: {
      type: 'string',
      allowNull: true,
      columnName: 'previous_container_name'
    },

    imageName: {
      type: 'string',
      allowNull: true,
      columnName: 'image_name'
    },

    hostPort: {
      type: 'number',
      allowNull: true,
      columnName: 'host_port'
    },

    buildContextPath: {
      type: 'string',
      allowNull: true,
      columnName: 'build_context_path'
    }
  },

  getQueuePosition: async function (deploymentId) {
    const job = await DeploymentJob.findOne({ deployment: deploymentId })
    if (!job || !['queued', 'claimed'].includes(job.stage)) return null

    const jobs = await DeploymentJob.find({
      targetKey: job.targetKey,
      stage: { in: ['queued', 'claimed'] }
    }).sort(['createdAt ASC', 'id ASC'])
    const index = jobs.findIndex((candidate) => candidate.id === job.id)
    return index === -1 ? null : index + 1
  }
}
