module.exports = ({ defineFactory }) =>
  defineFactory('gitrepository', ({ sequence }) => {
    const number = sequence('gitrepository', (value) => value)
    return {
      externalId: `repository-${number}`,
      fullName: `sailscastshq/site-${number}`,
      name: `site-${number}`,
      owner: 'sailscastshq',
      cloneUrl: `git@github.com:sailscastshq/site-${number}.git`,
      defaultBranch: 'main',
      branchMappings: { main: 'production' }
    }
  })
