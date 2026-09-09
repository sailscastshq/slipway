module.exports = {
  friendlyName: 'View app Wake',
  inputs: {
    slug: { type: 'string', required: true },
    envSlug: { type: 'string', defaultsTo: 'production' },
    appSlug: { type: 'string', required: true },
    tab: {
      type: 'string',
      defaultsTo: 'overview',
      isIn: ['overview', 'journeys', 'settings']
    },
    from: { type: 'string' },
    to: { type: 'string' },
    currency: { type: 'string' },
    visitor: { type: 'string' }
  },
  exits: {
    success: { responseType: 'inertia' },
    forbidden: { statusCode: 403 },
    badRequest: { statusCode: 400 }
  },
  fn: async function (inputs) {
    let access
    try {
      access = await sails.helpers.wake.resolveAccess.with({
        req: this.req,
        slug: inputs.slug,
        envSlug: inputs.envSlug,
        appSlug: inputs.appSlug
      })
    } catch {
      throw 'forbidden'
    }
    const reports = require('../../lib/wake-report')
    let filters
    try {
      filters = reports.range(inputs)
    } catch {
      throw 'badRequest'
    }
    let report = null,
      journeys = null,
      state = await sails.helpers.wake.resolveState(String(access.app.id))
    try {
      report = reports.report(access.app, filters)
      if (inputs.tab === 'journeys')
        journeys = reports.journeys(access.app, filters, inputs.visitor)
    } catch {
      state = { state: 'unavailable' }
    }
    return {
      page: 'projects/wake',
      props: {
        project: { slug: access.project.slug, name: access.project.name },
        environment: {
          slug: access.environment.slug,
          name: access.environment.name
        },
        app: {
          id: access.app.id,
          slug: access.app.slug,
          name: access.app.name,
          wakeEnabled: access.app.wakeEnabled,
          wakeSettings: access.app.wakeSettings
        },
        canManage: access.canManage,
        state,
        report,
        journeys,
        filters,
        tab: inputs.tab,
        visitor: inputs.visitor || ''
      }
    }
  }
}
