module.exports = {
  friendlyName: 'Reconcile deployments',

  description:
    'Recover interrupted deployment pipelines and dispatch durable queued work.',

  quest: {
    interval: '1 minute',
    withoutOverlapping: true
  },

  fn: async function () {
    await sails.helpers.deploy.ensureQueueSchema()
    await sails.helpers.deploy.reconcileDeployments()
    await sails.helpers.deploy.runQueuedDeployments()
  }
}
