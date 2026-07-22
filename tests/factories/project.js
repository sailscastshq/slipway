module.exports = ({ defineFactory }) =>
  defineFactory('project', ({ sequence }) => {
    const number = sequence('project')

    return {
      name: `Project ${number}`,
      slug: `project-${number}`,
      dockerfilePath: 'Dockerfile'
    }
  })
