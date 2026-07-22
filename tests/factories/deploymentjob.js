module.exports = ({ defineFactory }) =>
  defineFactory('deploymentjob', {
    targetKey: 'environment:1',
    appSlug: 'web',
    kind: 'deploy',
    stage: 'queued'
  })
