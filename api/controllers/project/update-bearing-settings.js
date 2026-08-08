const crypto = require('node:crypto')
const { normalizeBearingCategories } = require('../../lib/bearing-categories')

module.exports = {
  friendlyName: 'Update Bearing settings',

  description: 'Persist app-scoped Bearing availability and participation.',

  inputs: {
    slug: { type: 'string', required: true },
    envSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true },
    enabled: { type: 'boolean', required: true },
    acceptFeedback: { type: 'boolean', required: true },
    allowAnonymousParticipation: { type: 'boolean', required: true },
    feedbackCategories: { type: 'ref', required: true },
    showPublicRoadmap: { type: 'boolean', required: true },
    showPublicUpdates: { type: 'boolean', required: true },
    widgetEnabled: { type: 'boolean', required: true },
    widgetSide: {
      type: 'string',
      isIn: ['left', 'right'],
      required: true
    },
    widgetOpeningView: {
      type: 'string',
      isIn: ['feedback', 'updates'],
      required: true
    },
    showUnread: { type: 'boolean', required: true }
  },

  exits: {
    success: { responseType: 'inertiaRedirect' },
    notFound: { responseType: 'inertiaRedirect' },
    forbidden: { responseType: 'inertiaRedirect' }
  },

  fn: async function (inputs) {
    const { slug, envSlug, appSlug } = inputs
    const resolved = await resolveManager(this.req, {
      slug,
      envSlug,
      appSlug
    })
    const { user, project, environment, app } = resolved
    const values = {
      acceptFeedback: inputs.acceptFeedback,
      allowAnonymousParticipation: inputs.allowAnonymousParticipation,
      feedbackCategories: normalizeBearingCategories(inputs.feedbackCategories),
      showPublicRoadmap: inputs.showPublicRoadmap,
      showPublicUpdates: inputs.showPublicUpdates,
      widgetEnabled: inputs.widgetEnabled,
      widgetSide: inputs.widgetSide,
      widgetOpeningView: inputs.widgetOpeningView,
      showUnread: inputs.showUnread
    }
    const existing = await BearingSpace.findOne({ app: app.id })

    if (inputs.enabled) {
      await sails.helpers.bearing.ensureAppSecret.with({
        appId: String(app.id),
        rotate: !app.bearingEnabled
      })
    }
    await App.updateOne({ id: app.id }).set({
      bearingEnabled: inputs.enabled
    })

    if (existing) {
      await BearingSpace.updateOne({ id: existing.id }).set(values)
    } else {
      await BearingSpace.create({
        ...values,
        publicSlug: crypto.randomBytes(18).toString('base64url'),
        app: app.id,
        createdBy: user.id
      })
    }

    await sails.helpers.audit.log.with({
      action: 'bearing.settings.updated',
      resourceType: 'app',
      resourceId: String(app.id),
      userId: String(user.id),
      teamId: String(user.team),
      ipAddress: this.req.ip,
      details: {
        project: project.slug,
        environment: environment.slug,
        app: app.slug,
        enabled: inputs.enabled,
        allowAnonymousParticipation: inputs.allowAnonymousParticipation,
        feedbackCategories: values.feedbackCategories
      }
    })

    sails.inertia.flash(
      'success',
      inputs.enabled
        ? 'Bearing enabled. Redeploy this app to activate its public pages.'
        : 'Bearing settings saved.'
    )
    return bearingPath(project.slug, environment.slug, app.slug)
  }
}

async function resolveManager(req, { slug, envSlug, appSlug }) {
  try {
    return await sails.helpers.bearing.resolveManager.with({
      req,
      projectSlug: slug,
      environmentSlug: envSlug,
      appSlug
    })
  } catch (error) {
    if (error.code === 'forbidden') throw { forbidden: '/' }
    throw { notFound: '/' }
  }
}

function bearingPath(projectSlug, environmentSlug, appSlug) {
  return `/projects/${projectSlug}/environments/${environmentSlug}/apps/${appSlug}/bearing?view=settings`
}
