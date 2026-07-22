module.exports = ({ defineFactory }) =>
  defineFactory('team', ({ sequence }) => {
    const number = sequence('team')

    return {
      name: `Team ${number}`,
      slug: `team-${number}`
    }
  })
