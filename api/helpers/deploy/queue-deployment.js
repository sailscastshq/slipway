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
    expectedCurrent: { type: 'string' },
    acknowledgeUnknownCompatibility: { type: 'boolean', defaultsTo: false },
    dispatch: {
      type: 'boolean',
      defaultsTo: true,
      description: 'Whether to wake the in-process coordinator immediately.'
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    },
    cleanupInProgress: {
      outputType: 'ref'
    }
  },

  fn: async function ({
    values,
    app,
    kind,
    targetDeploymentId,
    dispatch,
    expectedCurrent,
    acknowledgeUnknownCompatibility
  }) {
    const environmentId = normalizeId(values.environment)
    if (!environmentId) {
      throw new Error('A queued deployment requires an environment.')
    }

    const environment = await Environment.findOne({ id: environmentId })
    if (!environment) {
      throw new Error(`Environment ${environmentId} no longer exists.`)
    }
    const cleanupScope = {
      projectId: normalizeId(environment.project),
      environmentId,
      appId: normalizeId(app)
    }
    const initialCleanup = await findBlockingCleanup(cleanupScope)
    if (initialCleanup) throw { cleanupInProgress: initialCleanup }

    if (
      app &&
      (await Setting.findOne({
        key:
          require('../../lib/deployment-recovery').HOLD_PREFIX + String(app.id)
      }))
    )
      throw new Error(
        'Traffic recovery requires operator inspection before another deployment or rollback.'
      )
    let recoveryIntent = null
    let bootstrapState = null
    if (kind === 'rollback') {
      if (!app || !expectedCurrent)
        throw new Error(
          'Rollback requires an app and the expected current release.'
        )
      app = await App.findOne({ id: app.id, environment: environmentId })
      if (!app) throw new Error('The rollback app no longer exists.')
      const target = await sails.helpers.deploy.resolveRecoveryTarget.with({
        app,
        deploymentId: String(targetDeploymentId),
        expectedCurrent
      })
      if (!target.available) throw new Error(target.reason)
      if (
        target.requiresCompatibilityAcknowledgement &&
        !acknowledgeUnknownCompatibility
      )
        throw new Error(
          'Unknown schema compatibility requires explicit acknowledgement; rollback does not undo migrations.'
        )
      bootstrapState = target.bootstrapState
      recoveryIntent = {
        appId: app.id,
        environmentId,
        expectedCurrent,
        targetDeploymentId,
        imageId: target.imageId,
        compatibility: target.compatibility,
        compatibilityStatus: target.compatibilityStatus,
        acknowledgeUnknownCompatibility: Boolean(
          acknowledgeUnknownCompatibility
        )
      }
      values = {
        ...values,
        imageId: target.imageId,
        imageName: target.target.imageName || target.imageId
      }
    }

    const appSlug = app?.slug || 'app'
    // The source cache and Caddy route are environment-wide resources. Keep
    // all app pipelines in the same environment queue so they cannot race at
    // those shared mutation boundaries.
    const targetKey = `environment:${environmentId}`
    let deployment
    let job

    await withDatastoreTransaction(async (db) => {
      if (recoveryIntent) {
        const currentApp = await App.findOne({ id: app.id }).usingConnection(db)
        if (String(currentApp?.currentDeployment) !== expectedCurrent)
          throw new Error(
            'The current release changed before rollback admission.'
          )
        if (bootstrapState) {
          const recovery = require('../../lib/deployment-recovery')
          const existing = await Setting.findOne({
            key: recovery.key(app.id)
          }).usingConnection(db)
          if (existing)
            throw new Error(
              'Recovery state changed during bootstrap; refresh before retrying.'
            )
          if (
            currentApp.imageId &&
            currentApp.imageId !== bootstrapState.current.imageId
          )
            throw new Error(
              'The current immutable image changed during bootstrap.'
            )
          for (const release of [
            bootstrapState.current,
            bootstrapState.previous
          ]) {
            const source = await Deployment.findOne({
              id: release.deploymentId,
              app: app.id,
              environment: environmentId
            }).usingConnection(db)
            if (
              !require('../../lib/legacy-deployment-artifact').verifyBinding(
                source,
                release,
                currentApp
              )
            )
              throw new Error(
                'Successful deployment provenance or immutable receipt changed during bootstrap.'
              )
            await Deployment.updateOne({ id: source.id })
              .set({ imageId: release.imageId })
              .usingConnection(db)
          }
          await App.updateOne({
            id: app.id,
            currentDeployment: currentApp.currentDeployment
          })
            .set({ imageId: bootstrapState.current.imageId })
            .usingConnection(db)
          await Setting.create({
            key: recovery.key(app.id),
            value: JSON.stringify(bootstrapState)
          }).usingConnection(db)
        }
      }
      deployment = await Deployment.create({
        ...values,
        status: 'pending',
        startedAt: null,
        app: app?.id || values.app || null
      })
        .fetch()
        .usingConnection(db)

      if (recoveryIntent)
        await Setting.create({
          key: `rollbackIntent:v1:${deployment.id}`,
          value: JSON.stringify(recoveryIntent)
        }).usingConnection(db)

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

    const racedCleanup = await findBlockingCleanup(cleanupScope)
    if (racedCleanup) {
      await withDatastoreTransaction(async (db) => {
        await DeploymentJob.destroyOne({ id: job.id }).usingConnection(db)
        await Deployment.destroyOne({ id: deployment.id }).usingConnection(db)
        await Setting.destroy({
          key: `rollbackIntent:v1:${deployment.id}`
        }).usingConnection(db)
      })
      throw { cleanupInProgress: racedCleanup }
    }

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

async function findBlockingCleanup(scope) {
  return sails.helpers.cleanup.assertAvailable
    .with(scope)
    .tolerate('blocked', (error) => error.raw || error)
}

async function getQueuePosition(job) {
  const jobs = await DeploymentJob.find({
    targetKey: job.targetKey,
    stage: { in: ['queued', 'claimed'] }
  }).sort(['createdAt ASC', 'id ASC'])

  const index = jobs.findIndex((candidate) => candidate.id === job.id)
  return index === -1 ? 1 : index + 1
}

// Share image-use admission with conservative deployment image retention.
module.exports.fn = require('../../lib/image-operation-guard').guard(
  module.exports.fn
)
