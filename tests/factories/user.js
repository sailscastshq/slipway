module.exports = ({ defineFactory }) =>
  defineFactory('user', ({ sequence }) => {
    const number = sequence('user')

    return {
      fullName: `Builder ${number}`,
      email: `builder-${number}@example.com`,
      password: 'secret123',
      emailStatus: 'verified'
    }
  }).trait('genesisOwner', {
    teamRole: 'owner',
    isGenesisUser: true
  })
