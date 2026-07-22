module.exports = ({ defineFactory }) =>
  defineFactory('environment', {
    name: 'Staging',
    slug: 'staging',
    isProduction: false
  }).trait('production', {
    name: 'Production',
    slug: 'production',
    isProduction: true
  })
