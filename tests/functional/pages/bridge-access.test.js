const crypto = require('node:crypto')
const { test } = require('sounding')
const { withCsrfFromPage } = require('../../support/csrf-request')

test(
  'Bridge access mutations return one Inertia location instead of replaying the mutation',
  { world: bridgeWorld('bridge-mutation-redirects', 'Bridge Redirects') },
  async ({ sails, world, request, expect }) => {
    const current = world.current
    const app = current.apps.web
    const environment = current.environments.production
    const project = current.projects.deploymentTarget
    const accessPath = bridgeAccessPath(project, environment, app)
    const access = await world.create('bridgeaccess').with({
      email: 'editor@host-app.example',
      role: 'viewer',
      status: 'active',
      hostUserId: 'host-editor-1',
      activatedAt: Date.now(),
      app: app.id,
      environment: environment.id,
      project: project.id,
      team: current.teams.genesisTeam.id,
      invitedBy: current.users.genesisUser.id
    })
    const browser = await withCsrfFromPage(request, accessPath, 'genesisUser')

    const enabled = await browser.request.patch(accessPath, { enabled: true })

    expect(enabled).toHaveStatus(409)
    expect(enabled).toHaveHeader('x-inertia-location', accessPath)
    expect((await sails.models.app.findOne({ id: app.id })).bridgeEnabled).toBe(
      true
    )

    const updated = await browser.request.patch(`${accessPath}/${access.id}`, {
      role: 'editor'
    })

    expect(updated).toHaveStatus(409)
    expect(updated).toHaveHeader('x-inertia-location', accessPath)
    expect(
      (await sails.models.bridgeaccess.findOne({ id: access.id })).role
    ).toBe('editor')

    const revoked = await browser.request.delete(
      `${accessPath}/${access.id}`,
      {}
    )

    expect(revoked).toHaveStatus(409)
    expect(revoked).toHaveHeader('x-inertia-location', accessPath)
    expect(
      (await sails.models.bridgeaccess.findOne({ id: access.id })).status
    ).toBe('revoked')
  }
)

test(
  'owner invites a host-app account without granting Slipway team access',
  { world: bridgeWorld('host-bridge-invite', 'Host Bridge Invite') },
  async ({ sails, world, request, visit, mailbox, expect }) => {
    const current = world.current
    const app = current.apps.web
    const environment = current.environments.production
    const project = current.projects.deploymentTarget
    const email = 'editor@host-app.example'

    await sails.models.environment.updateOne({ id: environment.id }).set({
      domain: 'host-app.example',
      features: {
        'sails-hook-slipway': { version: '0.1.0' }
      }
    })
    await sails.models.app.updateOne({ id: app.id }).set({
      bridgeEnabled: true
    })

    const accessPath = bridgeAccessPath(project, environment, app)
    const page = await visit.as('genesisUser')(accessPath)

    expect(page).toHaveStatus(200)
    expect(page).toBeInertiaPage('projects/bridge-access')
    expect(page).toHaveInertiaProps({
      'app.bridgeEnabled': true,
      'app.bridgeUrl': 'https://host-app.example/bridge',
      hookDetected: true
    })

    const appPage = await visit.as('genesisUser')(
      `/projects/${project.slug}/environments/${environment.slug}/apps/${app.slug}`
    )
    expect(appPage).toHaveInertiaProps({
      'app.bridgeUrl': 'https://host-app.example/bridge',
      canManageBridge: true
    })

    const member = await world.create('user').with({
      email: 'team-member@example.com',
      team: current.teams.genesisTeam.id,
      teamRole: 'member'
    })
    const memberAccess = await visit.as(member)(accessPath)
    expect(memberAccess).toHaveStatus(302)
    expect(memberAccess).toRedirectTo('/')

    const previousMailConfig = sails.config.sounding.mail
    sails.config.sounding.mail = {
      ...(previousMailConfig || {}),
      deliver: true
    }

    try {
      const browser = await withCsrfFromPage(request, accessPath, 'genesisUser')
      const response = await browser.request.post(`${accessPath}/invitations`, {
        email,
        role: 'editor'
      })

      expect(response).toHaveStatus(302)
      expect(response).toRedirectTo(accessPath)

      const access = await sails.models.bridgeaccess.findOne({
        app: app.id,
        email
      })
      const message = mailbox.latest()

      expect(access.status).toBe('pending')
      expect(access.role).toBe('editor')
      expect(access.hostUserId).toBe(null)
      expect(access.inviteTokenHash.length).toBe(64)
      expect(access.inviteTokenHash.startsWith('bli_')).toBe(false)
      expect(message.to).toContain(email)
      expect(message.template).toBe('bridge-invite')
      expect(message.html).toContain('https://host-app.example/bridge?invite=')

      const teamUser = await sails.models.user.findOne({ email })
      expect(teamUser).toBe(undefined)
    } finally {
      sails.config.sounding.mail = previousMailConfig
    }
  }
)

test(
  'verified host identity activates one app-scoped, revocable Bridge session',
  { world: bridgeWorld('host-bridge-exchange', 'Host Bridge Exchange') },
  async ({ sails, world, request, expect }) => {
    const current = world.current
    const app = current.apps.web
    const environment = current.environments.production
    const project = current.projects.deploymentTarget
    const email = 'invited@host-app.example'
    const inviteToken = 'bli_test-invite-token'
    const inviteTokenHash = sha256(inviteToken)

    await sails.models.app.updateOne({ id: app.id }).set({
      bridgeEnabled: true
    })
    const secret = await sails.helpers.bridge.ensureAppSecret.with({
      appId: String(app.id),
      rotate: true
    })
    const access = await world.create('bridgeaccess').with({
      email,
      role: 'viewer',
      status: 'pending',
      inviteTokenHash,
      inviteExpiresAt: Date.now() + 60 * 60 * 1000,
      app: app.id,
      environment: environment.id,
      project: project.id,
      team: current.teams.genesisTeam.id,
      invitedBy: current.users.genesisUser.id
    })
    const exchangePath = '/api/v1/bridge/exchange'
    const payload = {
      appId: String(app.id),
      hostUser: {
        id: 'host-user-42',
        email,
        fullName: 'Host Editor',
        emailVerified: true
      }
    }

    const wrongSecret = await request
      .withHeaders({
        authorization: 'Bearer slb_wrong',
        accept: 'application/json'
      })
      .post(exchangePath, {
        ...payload,
        inviteToken
      })
    expect(wrongSecret).toHaveStatus(401)

    const appClient = request.withHeaders({
      authorization: `Bearer ${secret}`,
      accept: 'application/json'
    })
    const unverified = await appClient.post(exchangePath, {
      ...payload,
      hostUser: {
        ...payload.hostUser,
        emailVerified: false
      },
      inviteToken
    })
    expect(unverified).toHaveStatus(400)

    const missingInvitation = await appClient.post(exchangePath, payload)
    expect(missingInvitation).toHaveStatus(403)

    const exchange = await appClient.post(exchangePath, {
      ...payload,
      inviteToken
    })
    expect(exchange).toHaveStatus(201)
    expect(exchange.data.launchUrl).toContain('/bridge/launch?code=blc_')

    const activated = await sails.models.bridgeaccess.findOne({
      id: access.id
    })
    expect(activated.status).toBe('active')
    expect(activated.hostUserId).toBe('host-user-42')
    expect(activated.hostUserName).toBe('Host Editor')
    expect(activated.inviteTokenHash).toBe(null)

    const stolenReplay = await appClient.post(exchangePath, {
      ...payload,
      hostUser: {
        ...payload.hostUser,
        id: 'different-host-user'
      },
      inviteToken
    })
    expect(stolenReplay).toHaveStatus(403)

    const renewed = await appClient.post(exchangePath, payload)
    expect(renewed).toHaveStatus(201)

    const launchUrl = new URL(exchange.data.launchUrl)
    const launchCodeValue = launchUrl.searchParams.get('code')
    const storedLaunchCode = await sails.models.bridgelaunchcode.findOne({
      tokenHash: sha256(launchCodeValue)
    })
    expect(Boolean(storedLaunchCode)).toBe(true)
    expect(storedLaunchCode.usedAt).toBe(null)
    expect(storedLaunchCode.expiresAt > Date.now()).toBe(true)
    const launchPath = `${launchUrl.pathname}${launchUrl.search}`
    const launch = await request.get(launchPath)
    const bridgePath = bridgeAppPath(project, environment, app)

    expect(launch).toHaveStatus(302)
    expect(launch).toRedirectTo(bridgePath)
    expect(launch.session.bridgeAccessId).toBe(access.id)
    expect(launch.session.bridgeAppId).toBe(app.id)
    expect(launch.session.userId).toBe(undefined)

    const replay = await request.get(launchPath)
    expect(replay).toHaveStatus(302)
    expect(replay).toRedirectTo('/login?error=bridge_link_expired')

    const bridgeClient = request.withSession(launch.session)
    const bridge = await bridgeClient.get(bridgePath, {
      headers: {
        'x-inertia': 'true',
        accept: 'text/html, application/xhtml+xml'
      }
    })
    expect(bridge).toHaveStatus(200)
    expect(bridge).toBeInertiaPage('projects/bridge')

    const editorPage = await bridgeClient.get(`${bridgePath}/user/new`)
    expect(editorPage).toHaveStatus(403)

    await sails.models.bridgeaccess
      .updateOne({ id: access.id })
      .set({ status: 'revoked', revokedAt: Date.now() })

    const revoked = await bridgeClient.get(bridgePath)
    expect(revoked).toHaveStatus(403)
  }
)

test(
  'rotating an app credential invalidates Bridge sessions from old containers',
  { world: bridgeWorld('host-bridge-rotation', 'Host Bridge Rotation') },
  async ({ sails, world, request, expect }) => {
    const current = world.current
    const app = current.apps.web
    const environment = current.environments.production
    const project = current.projects.deploymentTarget
    const secret = await enableBridge(sails, app.id)
    const access = await world.create('bridgeaccess').with({
      email: 'administrator@host-app.example',
      role: 'administrator',
      status: 'active',
      hostUserId: 'host-admin-1',
      activatedAt: Date.now(),
      app: app.id,
      environment: environment.id,
      project: project.id,
      team: current.teams.genesisTeam.id,
      invitedBy: current.users.genesisUser.id
    })

    const exchange = await request
      .withHeaders({
        authorization: `Bearer ${secret}`,
        accept: 'application/json'
      })
      .post('/api/v1/bridge/exchange', {
        appId: String(app.id),
        hostUser: {
          id: 'host-admin-1',
          email: access.email,
          fullName: 'Host Administrator',
          emailVerified: true
        }
      })
    const launchUrl = new URL(exchange.data.launchUrl)
    const launch = await request.get(`${launchUrl.pathname}${launchUrl.search}`)
    const bridgePath = bridgeAppPath(project, environment, app)

    await sails.helpers.bridge.ensureAppSecret.with({
      appId: String(app.id),
      rotate: true
    })

    const staleSession = await request
      .withSession(launch.session)
      .get(bridgePath)
    expect(staleSession).toHaveStatus(403)
  }
)

function bridgeAccessPath(project, environment, app) {
  return `${bridgeAppPath(project, environment, app)}/access`
}

function bridgeAppPath(project, environment, app) {
  return `/projects/${project.slug}/environments/${environment.slug}/apps/${app.slug}/bridge`
}

async function enableBridge(sails, appId) {
  await sails.models.app.updateOne({ id: appId }).set({
    bridgeEnabled: true
  })
  return sails.helpers.bridge.ensureAppSecret.with({
    appId: String(appId),
    rotate: true
  })
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function bridgeWorld(slug, name) {
  return {
    name: 'configured-slipway',
    context: {
      deploymentTarget: { slug, name }
    }
  }
}
