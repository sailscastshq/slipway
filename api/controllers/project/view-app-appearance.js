const store = require('../../lib/app-appearance-store')
module.exports = {
  friendlyName: 'View app appearance',
  inputs: {
    slug: { type: 'string', required: true },
    envSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true }
  },
  exits: {
    success: { responseType: 'inertia' },
    notFound: { statusCode: 404 },
    forbidden: { statusCode: 403 }
  },
  fn: async function ({ slug, envSlug, appSlug }) {
    const { project, environment, app } =
      await require('../../lib/app-appearance-access').manager({
        req: this.req,
        projectSlug: slug,
        environmentSlug: envSlug,
        appSlug
      })
    const base = `/projects/${project.slug}/environments/${environment.slug}/apps/${app.slug}`
    this.res.set('Cache-Control', 'private, no-store')
    return {
      page: 'projects/app-appearance',
      props: {
        project: { id: project.id, name: project.name, slug: project.slug },
        environment: { name: environment.name, slug: environment.slug },
        app: { id: app.id, name: app.name, slug: app.slug },
        appearance: await store.resolve(app, base, project.name)
      }
    }
  }
}
