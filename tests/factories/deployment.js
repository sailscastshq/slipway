module.exports = ({ defineFactory }) =>
  defineFactory('deployment', {
    status: 'pending',
    triggerType: 'manual',
    startedAt: 1
  }).trait('failed', {
    status: 'failed',
    finishedAt: 2
  })
