module.exports = ({ defineFactory }) =>
  defineFactory('service', ({ sequence }) => ({
    name: sequence('service-name', (number) => `database-${number}`),
    type: 'postgresql',
    version: '16'
  }))
