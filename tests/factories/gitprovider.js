module.exports = ({ defineFactory }) =>
  defineFactory('gitprovider', {
    type: 'github',
    name: 'GitHub (builder)',
    clientSecret: 'github-token',
    isActive: true
  })
