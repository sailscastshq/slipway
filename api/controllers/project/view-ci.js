module.exports = {
  friendlyName: 'View CI workspace',
  description:
    'A tenant-scoped, read-only foundation. No runner or policy is enabled by viewing this page.',
  inputs: {
    slug: { type: 'string', required: true },
    envSlug: { type: 'string', defaultsTo: 'production' }
  },
  exits: {
    success: { responseType: 'inertia' },
    notFound: { statusCode: 404 }
  },
  fn: async function ({ slug, envSlug }) {
    const user = await User.forRequest(this.req, { populateTeam: true })
    if (!user?.team?.id) throw 'notFound'
    const project = await Project.findOne({ slug, team: user.team.id })
    if (!project) throw 'notFound'
    const environment = await Environment.findOne({
      project: project.id,
      slug: envSlug
    })
    if (!environment) throw 'notFound'
    return {
      page: 'projects/ci',
      props: {
        project: { name: project.name, slug: project.slug },
        environment: { name: environment.name, slug: environment.slug },
        workspace: {
          version: 1,
          runner: 'not-configured',
          readOnly: true,
          runs: []
        }
      }
    }
  }
}
