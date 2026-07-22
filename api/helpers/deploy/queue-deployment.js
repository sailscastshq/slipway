const withDatastoreTransaction = require('../../lib/with-datastore-transaction')

module.exports = {
  friendlyName: 'Queue deployment',

  description:
    'Create a deployment and its durable pipeline job atomically, then ask the coordinator to run it.',

  inputs: {
    values: {
      type: 'ref',
      required: true,
      description: 'Values for the Deployment record.'
    },
    app: {
      type: 'ref',
      description: 'Target App record, when one already exists.'
    },
    kind: {
      type: 'string',
      isIn: ['deploy', 'rollback'],
      defaultsTo: 'deploy'
    },
    targetDeploymentId: {
      type: 'number',
      description: 'Existing deployment whose image a rollback will reuse.'
    },
    dispatch: {
      type: 'boolean',
      defaultsTo: true,
      description: 'Whether to wake the in-process coordinator immediately.'
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ values, app, kind, targetDeploymentId, dispatch }) {
    const environmentId = normalizeId(values.environment)
    if (!environmentId) {
      throw new Error('A queued deployment requires an environment.')
    }

    const appSlug = app?.slug || 'app'
    // The source cache and Caddy route are environment-wide resources. Keep
    // all app pipelines in the same environment queue so they cannot race at
    // those shared mutation boundaries.
    const targetKey = `environment:${environmentId}`
    let deployment
    let job

    await withDatastoreTransaction(async (db) => {
      deployment = await Deployment.create({
        ...values,
        status: 'pending',
        startedAt: null,
        app: app?.id || values.app || null
      })
        .fetch()
        .usingConnection(db)

      job = await DeploymentJob.create({
        deployment: deployment.id,
        targetKey,
        appSlug,
        kind,
        targetDeploymentId: targetDeploymentId || null,
        stage: 'queued'
      })
        .fetch()
        .usingConnection(db)
    })

    const queuePosition = await getQueuePosition(job)

    if (dispatch) {
      process.nextTick(() => {
        sails.helpers.deploy.runQueuedDeployments
          .with({ targetKey })
          .catch((error) => {
            sails.log.error(
              `Deployment queue ${targetKey} failed: ${error.message || error}`
            )
          })
      })
    }

    return {
      deployment,
      job,
      state: 'queued',
      queuePosition
    }
  }
}

function normalizeId(value) {
  if (value && typeof value === 'object') return value.id
  return value
}

async function getQueuePosition(job) {
  const jobs = await DeploymentJob.find({
    targetKey: job.targetKey,
    stage: { in: ['queued', 'claimed'] }
  }).sort(['createdAt ASC', 'id ASC'])

  const index = jobs.findIndex((candidate) => candidate.id === job.id)
  return index === -1 ? 1 : index + 1
}
