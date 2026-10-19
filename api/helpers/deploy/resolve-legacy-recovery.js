const recovery = require('../../lib/deployment-recovery')
const {
  receiptImageId,
  validPromotion
} = require('../../lib/legacy-deployment-artifact')
module.exports = {
  friendlyName: 'Resolve legacy recovery',
  description:
    'Read-only verification of existing successful deployment identities; never trust a tag alone.',
  inputs: {
    app: { type: 'ref', required: true },
    currentOnly: { type: 'boolean', defaultsTo: false }
  },
  exits: { success: { outputType: 'ref' } },
  fn: async function ({ app, currentOnly }) {
    const unavailable = (reason) => ({ available: false, reason })
    const current = await Deployment.findOne({
      id: recovery.id(app.currentDeployment),
      app: app.id,
      environment: app.environment
    })
    if (!validPromotion(current, app))
      return unavailable(
        'The current deployment has no verified successful app/environment provenance.'
      )
    const currentJob = await DeploymentJob.findOne({ deployment: current.id })
    if (
      currentJob &&
      ((!currentOnly && isRollback(current, currentJob)) ||
        currentJob.stage !== 'complete')
    )
      return unavailable(
        'Legacy rollback or unfinished history has no verified non-rejected recovery baseline.'
      )
    if (!currentOnly && isRollback(current, currentJob))
      return unavailable(
        'Legacy rollback history cannot prove a non-rejected previous recovery target.'
      )
    const currentProof = await artifact(current, true)
    if (!currentProof)
      return unavailable(
        'The current deployment lacks a recorded immutable image identity or a verifiable Docker build receipt.'
      )
    const release = (deployment, value) => ({
      deploymentId: String(deployment.id),
      imageId: value.imageId,
      promotedAt: deployment.finishedAt,
      legacyImageName: deployment.imageName,
      compatibility: value.compatibility
    })
    if (currentOnly)
      return {
        available: true,
        state: recovery.parse(
          {
            version: 1,
            appId: recovery.id(app.id),
            environmentId: recovery.id(app.environment),
            current: release(current, currentProof),
            previous: null,
            rejectedImages: []
          },
          app
        )
      }
    const history = await Deployment.find({
      app: app.id,
      environment: app.environment,
      status: { in: ['running', 'stopped'] },
      id: { '<': current.id }
    })
      .sort(['finishedAt DESC', 'id DESC'])
      .limit(201)
    for (const candidate of history.slice(0, 200)) {
      if (!validPromotion(candidate, app))
        return unavailable(
          'The previous successful deployment has incomplete promotion provenance.'
        )
      const job = await DeploymentJob.findOne({ deployment: candidate.id })
      if (job && job.stage !== 'complete')
        return unavailable(
          'The previous deployment has unfinished execution history.'
        )
      const proof = await artifact(candidate, false)
      if (!proof)
        return unavailable(
          'The previous successful deployment lacks a recorded immutable image identity or a verifiable Docker build receipt. A mutable tag alone cannot authorize recovery.'
        )
      if (proof.imageId === currentProof.imageId) {
        if (isRollback(candidate, job))
          return unavailable(
            'Legacy rollback history cannot prove that an older image was not rejected. The current release is preserved.'
          )
        continue
      }
      const state = recovery.parse(
        {
          version: 1,
          appId: recovery.id(app.id),
          environmentId: recovery.id(app.environment),
          current: release(current, currentProof),
          previous: release(candidate, proof),
          rejectedImages: []
        },
        app
      )
      return { available: true, state }
    }
    return unavailable(
      'No distinct verified previous healthy image is available in the bounded deployment history.'
    )

    async function artifact(deployment, isCurrent) {
      let imageId = deployment.imageId || (isCurrent ? app.imageId : null)
      if (imageId && !recovery.IMAGE_ID.test(imageId)) return null
      if (isCurrent && app.imageId && imageId && app.imageId !== imageId)
        return null
      if (!imageId) {
        const expectedName = await App.generateImageName(
          app.environment,
          String(deployment.id),
          app.slug
        )
        if (deployment.imageName !== expectedName) return null
        imageId = receiptImageId(deployment.buildLogs, expectedName)
      }
      if (!imageId) return null
      const inspected = await sails.helpers.docker.inspectDeploymentImage.with({
        imageReference: imageId
      })
      if (inspected.imageId !== imageId) return null
      return inspected
    }
  }
}

function isRollback(deployment, job) {
  return (
    job?.kind === 'rollback' ||
    /^Rollback to deployment [1-9][0-9]*$/i.test(deployment.gitMessage || '')
  )
}
