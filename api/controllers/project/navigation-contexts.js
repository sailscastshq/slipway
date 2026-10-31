module.exports = {
  friendlyName: 'List breadcrumb contexts',
  inputs: {
    kind: {
      type: 'string',
      isIn: ['project', 'environment', 'app'],
      required: true
    },
    projectSlug: { type: 'string', required: true },
    environmentSlug: { type: 'string' },
    appSlug: { type: 'string' },
    section: { type: 'string' }
  },
  exits: { notFound: { statusCode: 404 }, forbidden: { statusCode: 403 } },
  fn: async function ({
    kind,
    projectSlug,
    environmentSlug,
    appSlug,
    section
  }) {
    this.res.set('Cache-Control', 'private, no-store')
    const user = await User.forRequest(this.req)
    const project = await Project.findOne({
      slug: projectSlug,
      team: user.team
    })
    if (!project) throw 'notFound'
    let environment, app
    if (environmentSlug) {
      environment = await Environment.findOne({
        slug: environmentSlug,
        project: project.id
      })
      if (!environment) throw 'notFound'
    }
    if (appSlug) {
      if (!environment) throw 'notFound'
      app = await App.findOne({ slug: appSlug, environment: environment.id })
      if (!app) throw 'notFound'
    }
    const manager = ['owner', 'admin'].includes(user.teamRole)
    if (['bearing', 'appearance'].includes(section) && !manager)
      throw 'forbidden'
    const projectPath = `/projects/${project.slug}`
    const environmentPath =
      environment && `${projectPath}/environments/${environment.slug}`
    let records, scope, current, base
    if (kind === 'project') {
      records = await Project.find({ team: user.team })
        .select(['name', 'slug'])
        .sort('name ASC')
      scope = 'Projects in your team'
      current = project.slug
      base = '/projects'
    } else if (kind === 'environment' && environment) {
      records = await Environment.find({ project: project.id })
        .select(['name', 'slug'])
        .sort('name ASC')
      scope = `Environments in ${project.name}`
      current = environment.slug
      base = `${projectPath}/environments`
    } else if (kind === 'app' && app) {
      records = await App.find({ environment: environment.id })
        .select(['name', 'slug'])
        .sort('name ASC')
      scope = `Apps in ${project.name} / ${environment.name}`
      current = app.slug
      base = `${environmentPath}/apps`
    } else throw 'notFound'
    // Only app-wide sections with a stable index. Never transfer record IDs or queries.
    const suffix =
      kind === 'app' &&
      ['bearing', 'appearance', 'settings', 'quest', 'ci', 'wake'].includes(
        section
      )
        ? `/${section}`
        : ''
    return {
      scope,
      destination:
        kind === 'app' && (suffix || ['helm', 'dock'].includes(section))
          ? `${
              section.charAt(0).toUpperCase() + section.slice(1)
            } in selected app`
          : `${kind} overview`,
      items: records.map((record) => ({
        name: record.name,
        slug: record.slug,
        current: record.slug === current,
        href:
          kind === 'app' && ['helm', 'dock'].includes(section)
            ? `${environmentPath}/${section}?appSlug=${encodeURIComponent(
                record.slug
              )}`
            : `${base}/${record.slug}${suffix}`
      }))
    }
  }
}
