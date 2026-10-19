const recovery = require('../../lib/deployment-recovery')
module.exports = {
  friendlyName: 'Resolve recovery target',
  description:
    'Share previous-healthy eligibility between the UI, admission and rollback execution.',
  inputs: {
    app: { type: 'ref', required: true },
    deploymentId: { type: 'string' },
    expectedCurrent: { type: 'string' },
    checkBusy: { type: 'boolean', defaultsTo: true }
  },
  exits: { success: { outputType: 'ref' } },
  fn: async function ({ app, deploymentId, expectedCurrent, checkBusy }) {
    const unavailable = (reason, extra = {}) => ({
      available: false,
      reason,
      appId: app.id,
      appSlug: app.slug,
      currentDeploymentId: app.currentDeployment || null,
      ...extra
    })
    try {
      if (
        expectedCurrent &&
        recovery.id(app.currentDeployment) !== expectedCurrent
      )
        return unavailable(
          'The current release changed. Refresh before requesting rollback.'
        )
      if (
        await Setting.findOne({
          key: recovery.HOLD_PREFIX + recovery.id(app.id)
        })
      )
        return unavailable(
          'Traffic recovery requires operator inspection before another deployment or rollback.'
        )
      let { state } = await recovery.load(app)
      let bootstrapState = null
      if (!state) {
        const legacy = await sails.helpers.deploy.resolveLegacyRecovery.with({
          app
        })
        if (!legacy.available) return unavailable(legacy.reason)
        state = bootstrapState = legacy.state
      }
      if (!state?.previous)
        return unavailable(
          'No verified previous healthy recovery image is recorded for this app.'
        )
      const previous = state.previous
      const details = {
        targetDeploymentId: previous.deploymentId,
        imageId: previous.imageId,
        promotedAt: previous.promotedAt
      }
      if (deploymentId && deploymentId !== previous.deploymentId)
        return unavailable(
          'Only the recorded previous healthy release is eligible for rollback.',
          details
        )
      const target = await Deployment.findOne({
        id: previous.deploymentId,
        app: app.id,
        environment: app.environment,
        status: { in: ['running', 'stopped'] }
      })
      if (
        !target ||
        (!bootstrapState && target.imageId !== previous.imageId) ||
        recovery.id(target.id) === recovery.id(app.currentDeployment) ||
        previous.imageId === state.current.imageId ||
        state.rejectedImages.includes(previous.imageId)
      )
        return unavailable(
          'The recovery release identity is no longer valid.',
          details
        )
      if (
        checkBusy &&
        (await DeploymentJob.count({
          targetKey: `environment:${recovery.id(app.environment)}`,
          stage: { nin: ['complete', 'failed', 'cancelled'] }
        }))
      )
        return unavailable(
          'A deployment or rollback is already in progress for this environment.',
          details
        )
      const [artifact, current] = await Promise.all([
        sails.helpers.docker.inspectDeploymentImage.with({
          imageReference: previous.imageId
        }),
        sails.helpers.docker.inspectDeploymentImage.with({
          imageReference: state.current.imageId
        })
      ])
      if (
        artifact.imageId !== previous.imageId ||
        current.imageId !== state.current.imageId
      )
        return unavailable(
          'The local recovery image identity changed.',
          details
        )
      const targetDeclaration = artifact.compatibility
      const currentDeclaration = current.compatibility
      if (
        (targetDeclaration &&
          currentDeclaration &&
          targetDeclaration !== currentDeclaration) ||
        targetDeclaration !== previous.compatibility ||
        currentDeclaration !== state.current.compatibility
      )
        return unavailable(
          'The recorded image compatibility declarations conflict. Database and data changes are not reversed.',
          details
        )
      const compatibilityStatus =
        targetDeclaration && currentDeclaration ? 'declared' : 'unknown'
      return {
        available: true,
        reason: null,
        ...details,
        appId: app.id,
        appSlug: app.slug,
        currentDeploymentId: app.currentDeployment,
        compatibility: targetDeclaration,
        compatibilityStatus,
        requiresCompatibilityAcknowledgement: compatibilityStatus === 'unknown',
        bootstrapState,
        target
      }
    } catch (error) {
      return unavailable(
        'The local recovery image or recovery metadata is unavailable. Verify retained artifacts before retrying.'
      )
    }
  }
}
