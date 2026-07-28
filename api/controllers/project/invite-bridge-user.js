const crypto = require('crypto')

module.exports = {
  friendlyName: 'Invite Bridge user',

  description: 'Invite a verified host-app email to an app-scoped Bridge role.',

  inputs: {
    slug: { type: 'string', required: true },
    envSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true },
    email: {
      type: 'string',
      required: true,
      isEmail: true,
      maxLength: 200
    },
    role: {
      type: 'string',
      isIn: ['viewer', 'editor', 'administrator'],
      required: true
    }
  },

  exits: {
    success: { responseType: 'redirect' },
    badRequest: { responseType: 'badRequest' },
    notFound: { responseType: 'redirect' },
    forbidden: { responseType: 'redirect' }
  },

  fn: async function ({ slug, envSlug, appSlug, email, role }) {
    let resolved
    try {
      resolved = await sails.helpers.bridge.resolveManager.with({
        req: this.req,
        projectSlug: slug,
        environmentSlug: envSlug,
        appSlug
      })
    } catch (error) {
      if (error.code === 'forbidden') throw { forbidden: '/' }
      throw { notFound: '/' }
    }

    const normalizedEmail = email.trim().toLowerCase()
    const { user, project, environment, app } = resolved
    const appUrl = await sails.helpers.bridge.getAppUrl.with({
      app,
      environment,
      project
    })
    if (!appUrl) {
      throw {
        badRequest: {
          problems: [
            {
              email:
                'Deploy this app with a reachable URL before inviting Bridge users.'
            }
          ]
        }
      }
    }

    const inviteToken = `bli_${crypto.randomBytes(32).toString('base64url')}`
    const inviteTokenHash = crypto
      .createHash('sha256')
      .update(inviteToken)
      .digest('hex')
    const inviteExpiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000
    const existing = await BridgeAccess.findOne({
      app: app.id,
      email: normalizedEmail
    })

    let access
    if (existing) {
      access = await BridgeAccess.updateOne({ id: existing.id }).set({
        role,
        status: 'pending',
        hostUserId: null,
        hostUserName: null,
        activatedAt: null,
        revokedAt: null,
        revokedBy: null,
        inviteTokenHash,
        inviteExpiresAt,
        invitedBy: user.id
      })
    } else {
      access = await BridgeAccess.create({
        email: normalizedEmail,
        role,
        status: 'pending',
        inviteTokenHash,
        inviteExpiresAt,
        app: app.id,
        environment: environment.id,
        project: project.id,
        team: user.team,
        invitedBy: user.id
      }).fetch()
    }

    const inviteUrl = `${appUrl}/bridge?invite=${encodeURIComponent(
      inviteToken
    )}`
    try {
      await sails.helpers.mail.sendConfigured.with({
        to: normalizedEmail,
        subject: `You have been invited to ${app.name} Bridge`,
        template: 'bridge-invite',
        templateData: {
          appName: app.name,
          projectName: project.name,
          inviterName: user.fullName,
          role,
          inviteUrl,
          expiresIn: '7 days'
        }
      })
    } catch (error) {
      sails.log.warn(
        `Bridge invitation email failed for ${normalizedEmail}: ${
          error.message || error
        }`
      )
      throw {
        badRequest: {
          problems: [
            {
              email:
                'The invitation was saved, but Slipway could not send the email. Check the mail settings and resend it.'
            }
          ]
        }
      }
    }

    await sails.helpers.audit.log.with({
      action: existing ? 'bridge.access.reinvited' : 'bridge.access.invited',
      resourceType: 'bridgeAccess',
      resourceId: String(access.id),
      userId: String(user.id),
      teamId: String(user.team),
      ipAddress: this.req.ip,
      details: {
        appId: app.id,
        email: normalizedEmail,
        role
      }
    })

    sails.inertia.flash('success', `Invitation sent to ${normalizedEmail}.`)
    return accessPath(project.slug, environment.slug, app.slug)
  }
}

function accessPath(projectSlug, environmentSlug, appSlug) {
  return `/projects/${projectSlug}/environments/${environmentSlug}/apps/${appSlug}/bridge/access`
}
