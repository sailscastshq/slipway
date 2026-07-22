module.exports = ({ defineFactory }) =>
  defineFactory('backup', {
    status: 'pending',
    type: 'manual'
  })
