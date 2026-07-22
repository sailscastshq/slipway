module.exports = ({ defineFactory }) =>
  defineFactory('app', {
    name: 'Web',
    slug: 'web'
  }).trait('configured', {
    dockerfilePath: 'Dockerfile',
    routePath: '/',
    isDefault: true
  })
