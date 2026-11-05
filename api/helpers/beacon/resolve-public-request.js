const page = require('../../lib/beacon/public-page')
module.exports = {
  friendlyName: 'Resolve public Beacon request',
  inputs: {
    req: { type: 'ref', required: true },
    projectSlug: { type: 'string', required: true },
    environmentSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true }
  },
  exits: { notFound: {} },
  fn: async function ({ req, projectSlug, environmentSlug, appSlug }) {
    const project = await Project.findOne({ slug: projectSlug })
    const environment = project
      ? await Environment.findOne({
          project: project.id,
          slug: environmentSlug
        })
      : null
    const app = environment
      ? await App.findOne({ environment: environment.id, slug: appSlug })
      : null
    if (!app || app.routePath === null) throw 'notFound'
    const setting = await Setting.findOne({ key: page.key(app.id) })
    if (!page.enabled(setting?.value)) throw 'notFound'
    const base = page.publicPath(app)
    const internal = page.internalPath(project, environment, app)
    if (
      typeof req.url === 'string' &&
      (req.url === internal ||
        req.url.startsWith(internal + '/') ||
        req.url.startsWith(internal + '?'))
    ) {
      req.url = base + req.url.slice(internal.length)
    }
    return {
      app,
      publicBasePath: base,
      homePath: page.prefix(app) || '/',
      hostAssetBasePath: `${page.prefix(app)}/_slipway/beacon/_assets`,
      appearance: await require('../../lib/app-appearance-store').resolve(
        app,
        `${base}/_`,
        project.name
      )
    }
  }
}
