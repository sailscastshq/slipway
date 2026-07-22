module.exports = ({ defineFactory }) =>
  defineFactory('deploymentlease', {
    targetKey: 'environment:1',
    token: 'lease-token',
    owner: 'sounding',
    stage: 'claimed',
    heartbeatAt: 1,
    expiresAt: 2
  })
