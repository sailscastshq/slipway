const crypto = require('node:crypto')
const { test } = require('sounding')
const {
  INERTIA_HEADERS,
  withCsrfFromPage
} = require('../../support/csrf-request')

test(
  'Bearing defaults to identified host-app participation and persists settings',
  {
    socket: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'bearing-settings',
          name: 'Bearing Settings'
        }
      }
    }
  },
  async ({ sails, world, request, visit, expect }) => {
    const current = world.current
    const app = current.apps.web
    const environment = current.environments.production
    const project = current.projects.deploymentTarget
    const path = bearingPath(project, environment, app)

    await sails.models.environment.updateOne({ id: environment.id }).set({
      domain: 'product.example.com',
      features: {
        'sails-hook-slipway': { version: '0.0.7' }
      }
    })

    const page = await visit.as('genesisUser')(path)

    expect(page).toHaveStatus(200)
    expect(page).toBeInertiaPage('projects/bearing')
    expect(page).toHaveInertiaProps({
      'bearing.enabled': false,
      'bearing.acceptFeedback': true,
      'bearing.allowAnonymousParticipation': false,
      'bearing.feedbackCategories': [
        { key: 'feature', label: 'Feature', active: true },
        { key: 'bug', label: 'Bug', active: true }
      ],
      'bearing.showPublicRoadmap': true,
      'bearing.showPublicUpdates': true,
      'bearing.widgetEnabled': false,
      'publicUrls.feedback': 'https://product.example.com/bearing/feedback',
      'publicUrls.roadmap': 'https://product.example.com/bearing/roadmap',
      'publicUrls.updates': 'https://product.example.com/bearing/updates',
      hookDetected: true
    })
    expect(await sails.models.bearingspace.count({ app: app.id })).toBe(0)

    const browser = await withCsrfFromPage(request, path, 'genesisUser')
    const updated = await browser.request.patch(path, {
      enabled: true,
      acceptFeedback: true,
      allowAnonymousParticipation: false,
      feedbackCategories: [
        { key: 'feature', label: 'Feature', active: true },
        { key: 'bug', label: 'Bug report', active: true }
      ],
      showPublicRoadmap: true,
      showPublicUpdates: true,
      widgetEnabled: true,
      widgetSide: 'right',
      widgetOpeningView: 'updates',
      showUnread: true
    })

    expect(updated).toHaveStatus(409)
    expect(updated).toHaveHeader('x-inertia-location', `${path}?view=settings`)

    const space = await sails.models.bearingspace.findOne({ app: app.id })
    expect(
      (await sails.models.app.findOne({ id: app.id })).bearingEnabled
    ).toBe(true)
    expect(space.allowAnonymousParticipation).toBe(false)
    expect(space.feedbackCategories[1].label).toBe('Bug report')
    expect(space.publicSlug.length > 20).toBe(true)
    expect(
      Boolean(
        (await sails.models.app.findOne({ id: app.id }).decrypt()).bearingSecret
      )
    ).toBe(true)

    const audit = await sails.models.auditlog.findOne({
      action: 'bearing.settings.updated',
      resourceId: String(app.id)
    })
    expect(audit.details.allowAnonymousParticipation).toBe(false)
  }
)

test(
  'Bearing management is limited to app owners and administrators',
  {
    socket: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'bearing-manager-access',
          name: 'Bearing Manager Access'
        }
      }
    }
  },
  async ({ world, visit, expect }) => {
    const current = world.current
    const path = bearingPath(
      current.projects.deploymentTarget,
      current.environments.production,
      current.apps.web
    )
    const member = await world.create('user').with({
      email: 'bearing-member@example.com',
      team: current.teams.genesisTeam.id,
      teamRole: 'member'
    })

    const page = await visit.as(member)(path)

    expect(page).toHaveStatus(302)
    expect(page).toRedirectTo('/')
  }
)

test(
  'Bearing overview totals stay exact beyond the bounded management lists',
  {
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'bearing-exact-overview-counts',
          name: 'Bearing Exact Overview Counts'
        }
      }
    }
  },
  async ({ sails, world, visit, expect }) => {
    const current = world.current
    const app = current.apps.web
    const environment = current.environments.production
    const project = current.projects.deploymentTarget
    const space = await sails.models.bearingspace
      .create({
        publicSlug: 'exact-overview-counts',
        app: app.id,
        createdBy: current.users.genesisUser.id
      })
      .fetch()

    for (const feedback of Array.from({ length: 101 }, (_, index) => ({
      publicId: `bfd_exact_${index}`,
      title: `Feedback ${index + 1}`,
      status: index === 0 ? 'planned' : 'reviewing',
      voteCount: 2,
      category: 'feature',
      submittedAnonymously: true,
      app: app.id,
      space: space.id
    }))) {
      await sails.models.bearingfeedback.create(feedback)
    }
    const now = Date.now()
    for (const participant of Array.from({ length: 101 }, (_, index) => ({
      participantKey: `generated-by-lifecycle-${index}`,
      hostUserId: `customer-${index}`,
      displayName: `Customer ${index}`,
      email: `customer-${index}@example.com`,
      emailVerifiedAt: now,
      firstSeenAt: now,
      lastSeenAt: now,
      space: space.id
    }))) {
      await sails.models.bearingparticipant.create(participant)
    }
    for (const update of Array.from({ length: 51 }, (_, index) => ({
      publicId: `bup_exact_${index}`,
      title: `Update ${index + 1}`,
      slug: `update-${index + 1}`,
      excerpt: `Update ${index + 1} is ready.`,
      body: `Details for update ${index + 1}.`,
      status: 'published',
      publishedAt: now + index,
      author: current.users.genesisUser.id,
      app: app.id,
      space: space.id
    }))) {
      await sails.models.bearingupdate.create(update)
    }

    const page = await visit.as('genesisUser')(
      `${bearingPath(project, environment, app)}?view=overview`
    )

    expect(page).toHaveStatus(200)
    expect(page.data.props.feedback.length).toBe(100)
    expect(page.data.props.participants).toBe(undefined)
    expect(page.data.props.updates.length).toBe(50)
    expect(page.data.props.attentionFeedback.length).toBe(5)
    expect(page.data.props.counts).toEqual({
      feedback: 101,
      votes: 202,
      planned: 1,
      participants: 101,
      publishedUpdates: 51
    })
  }
)

test(
  'Bearing participants are app-scoped identities instead of Slipway users',
  {
    socket: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'bearing-participant',
          name: 'Bearing Participant'
        }
      }
    }
  },
  async ({ sails, world, expect }) => {
    const current = world.current
    const hostUserId = 'customer-42'
    const space = await sails.models.bearingspace
      .create({
        publicSlug: 'participant-test-space',
        app: current.apps.web.id,
        createdBy: current.users.genesisUser.id
      })
      .fetch()
    const suppliedKey = crypto
      .createHash('sha256')
      .update(`${space.id}:${hostUserId}`)
      .digest('hex')
    const now = Date.now()

    const participant = await sails.models.bearingparticipant
      .create({
        participantKey: suppliedKey,
        hostUserId,
        displayName: '  Ada Customer  ',
        email: 'ada@example.com',
        emailVerifiedAt: now,
        firstSeenAt: now,
        lastSeenAt: now,
        space: space.id
      })
      .fetch()

    const decrypted = await sails.models.bearingparticipant
      .findOne({ id: participant.id })
      .decrypt()
    expect(decrypted.displayName).toBe('Ada Customer')
    expect(decrypted.email).toBe('ada@example.com')
    expect(decrypted.participantKey).toBe(suppliedKey)
    expect(await sails.models.user.findOne({ email: 'ada@example.com' })).toBe(
      undefined
    )
  }
)

test(
  'Bearing exchanges a verified host user for one single-use participant session',
  {
    socket: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'bearing-identity-exchange',
          name: 'Bearing Identity Exchange'
        }
      }
    }
  },
  async ({ sails, world, request, expect }) => {
    const current = world.current
    const app = current.apps.web
    const environment = current.environments.production
    const project = current.projects.deploymentTarget

    await sails.models.environment.updateOne({ id: environment.id }).set({
      domain: 'feedback.example.com'
    })
    await sails.models.app.updateOne({ id: app.id }).set({
      bearingEnabled: true
    })
    const secret = await sails.helpers.bearing.ensureAppSecret.with({
      appId: String(app.id),
      rotate: true
    })
    const space = await sails.models.bearingspace
      .create({
        publicSlug: 'identity-exchange-space',
        app: app.id,
        createdBy: current.users.genesisUser.id
      })
      .fetch()
    const exchangePath = '/api/v1/bearing/exchange'
    const payload = {
      appId: String(app.id),
      hostUser: {
        id: 'customer-42',
        email: 'customer@example.com',
        fullName: 'Customer Forty Two',
        emailVerified: true
      }
    }

    const forged = await request
      .withHeaders({
        authorization: 'Bearer slr_forged',
        accept: 'application/json'
      })
      .post(exchangePath, payload)
    expect(forged).toHaveStatus(401)

    const appClient = request.withHeaders({
      authorization: `Bearer ${secret}`,
      accept: 'application/json'
    })
    const unverified = await appClient.post(exchangePath, {
      ...payload,
      hostUser: { ...payload.hostUser, emailVerified: false }
    })
    expect(unverified).toHaveStatus(400)

    const exchange = await appClient.post(exchangePath, payload)
    expect(exchange).toHaveStatus(201)
    const launchUrl = new URL(exchange.data.launchUrl)
    expect(launchUrl.origin).toBe('https://feedback.example.com')
    expect(launchUrl.pathname).toBe('/_slipway/bearing/session')
    expect(launchUrl.searchParams.get('code')).toMatch(/^bnc_/)

    const participant = await sails.models.bearingparticipant
      .findOne({ space: space.id, hostUserId: 'customer-42' })
      .decrypt()
    expect(participant.email).toBe('customer@example.com')
    expect(participant.displayName).toBe('Customer Forty Two')

    const launchPath = `${launchUrl.pathname}${launchUrl.search}`
    const launch = await request.get(launchPath)
    expect(launch).toHaveStatus(302)
    expect(launch).toRedirectTo('/bearing/feedback')
    expect(launch.session.bearingParticipantId).toBe(participant.id)
    expect(launch.session.bearingAppId).toBe(app.id)

    const replay = await request.get(launchPath)
    expect(replay).toHaveStatus(302)
    expect(replay).toRedirectTo('/bearing/feedback?error=bearing_link_expired')
  }
)

test(
  'public Bearing feedback is readable by everyone and writable by the proven host user',
  {
    socket: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'bearing-public-feedback',
          name: 'Bearing Public Feedback'
        }
      }
    }
  },
  async ({ sails, world, request, sockets, expect }) => {
    const current = world.current
    const app = current.apps.web
    const environment = current.environments.production
    const project = current.projects.deploymentTarget

    await sails.models.environment.updateOne({ id: environment.id }).set({
      domain: 'ideas.example.com'
    })
    await sails.models.app.updateOne({ id: app.id }).set({
      bearingEnabled: true
    })
    const secret = await sails.helpers.bearing.ensureAppSecret.with({
      appId: String(app.id),
      rotate: true
    })
    const space = await sails.models.bearingspace
      .create({
        publicSlug: 'public-feedback-space',
        app: app.id,
        createdBy: current.users.genesisUser.id
      })
      .fetch()
    const publicPath = `/bearing/public/${project.slug}/${environment.slug}/${app.slug}/feedback`
    const publicBasePath = `/bearing/public/${project.slug}/${environment.slug}/${app.slug}`
    const hostPath = `/bearing/host/${project.slug}/${environment.slug}/${app.slug}/feedback`
    const hostBasePath = `/bearing/host/${project.slug}/${environment.slug}/${app.slug}`

    const namespace = await request.get(publicBasePath)
    expect(namespace).toHaveStatus(302)
    expect(namespace).toRedirectTo(`${publicBasePath}/feedback`)

    const legacyHostNamespace = await request
      .withHeaders({ 'x-forwarded-host': 'ideas.example.com' })
      .get(publicBasePath)
    expect(legacyHostNamespace).toHaveStatus(302)
    expect(legacyHostNamespace).toRedirectTo('/bearing/feedback')

    const hostNamespace = await request.get(hostBasePath)
    expect(hostNamespace).toHaveStatus(302)
    expect(hostNamespace).toRedirectTo('/bearing/feedback')

    const guestPage = await visitPage(request, publicPath)
    expect(guestPage).toHaveStatus(200)
    expect(guestPage).toBeInertiaPage('bearing/feedback')
    expect(guestPage).toHaveInertiaProps({
      participant: null,
      'bearing.allowAnonymousParticipation': false,
      'app.feedbackPath': publicPath,
      'app.publicUrl': `https://localhost${publicPath}`,
      'app.ogImageUrl': `https://localhost${publicPath}/og.png`,
      hostAssetBasePath: ''
    })

    const hostPage = await request
      .withHeaders({
        ...INERTIA_HEADERS,
        host: 'ideas.example.com',
        'x-forwarded-host': 'ideas.example.com'
      })
      .get(hostPath)
    expect(hostPage).toHaveInertiaProps({
      'app.feedbackPath': '/bearing/feedback',
      'app.roadmapPath': '/bearing/roadmap',
      'app.updatesPath': '/bearing/updates',
      'app.identityPath': '/_slipway/bearing/identity',
      'app.publicUrl': 'https://ideas.example.com/bearing/feedback',
      'app.ogImageUrl': 'https://ideas.example.com/bearing/feedback/og.png',
      'realtime.socketPath': '/_slipway/bearing/socket.io',
      'realtime.subscribePath': `${hostBasePath}/realtime`,
      hostAssetBasePath: '/_slipway/bearing/_assets'
    })

    const legacyHostPage = await request
      .withHeaders({
        ...INERTIA_HEADERS,
        host: 'ideas.example.com',
        'x-forwarded-host': 'ideas.example.com'
      })
      .get(publicPath)
    expect(legacyHostPage).toHaveInertiaProps({
      'app.feedbackPath': '/bearing/feedback',
      'app.roadmapPath': '/bearing/roadmap',
      'app.updatesPath': '/bearing/updates',
      'realtime.subscribePath': `${publicBasePath}/realtime`
    })

    const guest = await withCsrfFromPage(request, publicPath)
    const blocked = await guest.request.post(publicPath, {
      title: 'A guest should not get through',
      details: ''
    })
    expect(blocked).toHaveStatus(403)

    const exchange = await request
      .withHeaders({
        authorization: `Bearer ${secret}`,
        accept: 'application/json'
      })
      .post('/api/v1/bearing/exchange', {
        appId: String(app.id),
        hostUser: {
          id: 'feedback-customer',
          email: 'feedback-customer@example.com',
          fullName: 'Ada Feedback',
          emailVerified: true
        }
      })
    const launchUrl = new URL(exchange.data.launchUrl)
    const launch = await request.get(`${launchUrl.pathname}${launchUrl.search}`)
    const participantClient = request
      .withSession(launch.session)
      .withHeaders(INERTIA_HEADERS)
    const participantPage = await participantClient.get(publicPath)
    expect(participantPage).toHaveInertiaProps({
      'participant.displayName': 'Ada Feedback'
    })
    const realtime = participantPage.data.props.realtime
    const tokenPayload = JSON.parse(
      Buffer.from(realtime.token.split('.')[0], 'base64url').toString('utf8')
    )
    const socket = await sockets.connect({
      initialConnectionHeaders: {
        origin: tokenPayload.origin,
        'x-bearing-realtime-token': realtime.token
      }
    })
    const subscription = await socket.get(
      `${realtime.subscribePath}?token=${encodeURIComponent(realtime.token)}`
    )
    expect(subscription).toHaveStatus(200)
    expect(subscription.data.feedback).toEqual([])
    const invalidCategory = await participantClient
      .withHeaders({ 'x-csrf-token': participantPage.data.props._csrf })
      .post(publicPath, {
        category: 'archived-category',
        title: 'This category should not be accepted',
        details: ''
      })
    expect(invalidCategory).toHaveStatus(400)
    const liveFeedback = socket.receive('bearing:feedback')
    const created = await participantClient
      .withHeaders({ 'x-csrf-token': participantPage.data.props._csrf })
      .post(publicPath, {
        category: 'bug',
        title: 'Let me choose a calmer notification sound',
        details: 'The current sound is easy to miss during focused work.'
      })
    expect(created).toHaveStatus(409)
    expect(created).toHaveHeader('x-inertia-location', publicPath)

    const event = await liveFeedback
    expect(event.verb).toBe('created')
    expect(event.feedback.title).toBe(
      'Let me choose a calmer notification sound'
    )
    expect(event.feedback.authorName).toBe('Ada Feedback')

    const feedback = await sails.models.bearingfeedback
      .findOne({ space: space.id })
      .populate('author')
    expect(feedback.title).toBe('Let me choose a calmer notification sound')
    expect(feedback.category).toBe('bug')
    expect(feedback.author.displayName).toBe('Ada Feedback')
    expect(feedback.submittedAnonymously).toBe(false)

    const permalink = await participantClient.get(
      `${publicPath}/${feedback.publicId}`
    )
    expect(permalink).toHaveStatus(200)
    expect(permalink).toHaveInertiaProps({
      focusedFeedbackId: feedback.publicId,
      'app.publicUrl': `https://localhost${publicPath}/${feedback.publicId}`,
      'feedback.data.0.publicId': feedback.publicId,
      'feedback.data.0.title': 'Let me choose a calmer notification sound'
    })

    const voter = participantClient.withHeaders({
      accept: 'application/json',
      'x-csrf-token': participantPage.data.props._csrf
    })
    const voted = await voter.post(`${publicPath}/${feedback.publicId}/vote`)
    expect(voted).toHaveStatus(200)
    expect(voted.data.voted).toBe(true)
    expect(voted.data.voteCount).toBe(1)
    const unvoted = await voter.post(`${publicPath}/${feedback.publicId}/vote`)
    expect(unvoted.data.voted).toBe(false)
    expect(unvoted.data.voteCount).toBe(0)

    const managementPath = bearingPath(project, environment, app)
    const manager = await withCsrfFromPage(
      request,
      managementPath,
      'genesisUser'
    )
    const published = await manager.request.post(`${managementPath}/updates`, {
      title: 'Calmer notifications have shipped',
      excerpt: 'Notification sounds now fit focused work.',
      body: 'Choose the notification sound that works for your day.\n\n## Why it matters\n\nFocused work should stay focused.',
      feedbackIds: [feedback.publicId],
      publish: true
    })
    expect(published).toHaveStatus(409)
    expect(published).toHaveHeader(
      'x-inertia-location',
      `${managementPath}?view=updates`
    )
    expect(
      (await sails.models.bearingfeedback.findOne({ id: feedback.id })).status
    ).toBe('shipped')

    const update = await sails.models.bearingupdate.findOne({
      space: space.id,
      title: 'Calmer notifications have shipped'
    })
    expect(update.slug).toBe('calmer-notifications-have-shipped')

    const updatesPath = `/bearing/public/${project.slug}/${environment.slug}/${app.slug}/updates`
    const archive = await participantClient.get(updatesPath)
    expect(archive).toHaveStatus(200)
    expect(archive).toBeInertiaPage('bearing/surface')
    expect(archive).toHaveInertiaProps({
      'app.publicUrl': `https://localhost${updatesPath}`,
      'app.ogImageUrl': `https://localhost${updatesPath}/og.png`,
      'items.0.slug': update.slug,
      'items.0.title': 'Calmer notifications have shipped'
    })

    const updatePath = `${updatesPath}/p/${update.slug}`
    const updatePage = await participantClient.get(updatePath)
    expect(updatePage).toHaveStatus(200)
    expect(updatePage).toBeInertiaPage('bearing/update')
    expect(updatePage).toHaveInertiaProps({
      'update.slug': update.slug,
      'update.title': 'Calmer notifications have shipped',
      'update.authorName': current.users.genesisUser.fullName,
      'update.linkedFeedback.0.publicId': feedback.publicId,
      publicUrl: `https://localhost${updatePath}`
    })

    const missingUpdate = await participantClient.get(
      `${updatesPath}/p/not-a-real-update`
    )
    expect(missingUpdate).toHaveStatus(404)

    const widgetConfig = await request.get(
      `/bearing/public/${project.slug}/${environment.slug}/${app.slug}/widget-config`
    )
    expect(widgetConfig).toHaveStatus(200)
    expect(widgetConfig.data.latestUpdate.title).toBe(
      'Calmer notifications have shipped'
    )

    const bootstrap = await request.get(
      `/bearing/public/${project.slug}/${environment.slug}/${app.slug}/bootstrap.js`
    )
    expect(bootstrap).toHaveStatus(200)
    expect(bootstrap.body).toContain('slipway:bearing:')
    expect(bootstrap.body).toContain('What’s new')

    for (const paginatedFeedback of Array.from({ length: 25 }, (_, index) => ({
      publicId: `bfd-pagination-${index + 1}`,
      category: index % 2 === 0 ? 'feature' : 'bug',
      title: `Pagination feedback ${index + 1}`,
      details: 'Loaded as the feedback board approaches its scroll boundary.',
      status: 'reviewing',
      voteCount: 0,
      app: app.id,
      space: space.id
    }))) {
      await sails.models.bearingfeedback.create(paginatedFeedback)
    }

    const firstPage = await participantClient.get(`${publicPath}?page=1`)
    expect(firstPage).toHaveStatus(200)
    expect(firstPage.data.props.feedback.data.length).toBe(20)
    expect(firstPage.data.props.feedback.meta.current_page).toBe(1)
    expect(firstPage.data.props.feedback.meta.total).toBe(26)
    expect(firstPage.data.props.feedback.meta.last_page).toBe(2)
    expect(firstPage.data.props.feedback.meta.next_page).toBe(2)
    expect(firstPage.data.props.feedback.meta.prev_page).toBe(null)
    expect(firstPage.data.scrollProps.feedback.currentPage).toBe(1)
    expect(firstPage.data.scrollProps.feedback.previousPage).toBe(null)
    expect(firstPage.data.scrollProps.feedback.nextPage).toBe(2)
    expect(firstPage.data.mergeProps).toContain('feedback.data')
    expect(firstPage.data.matchPropsOn).toContain('feedback.data.publicId')

    const secondPage = await participantClient.get(`${publicPath}?page=2`)
    expect(secondPage).toHaveStatus(200)
    expect(secondPage.data.props.feedback.data.length).toBe(6)
    expect(secondPage.data.props.feedback.meta.current_page).toBe(2)
    expect(secondPage.data.props.feedback.meta.total).toBe(26)
    expect(secondPage.data.props.feedback.meta.last_page).toBe(2)
    expect(secondPage.data.props.feedback.meta.next_page).toBe(null)
    expect(secondPage.data.props.feedback.meta.prev_page).toBe(1)
    const paginatedPublicIds = [
      ...firstPage.data.props.feedback.data,
      ...secondPage.data.props.feedback.data
    ].map((item) => item.publicId)
    expect(new Set(paginatedPublicIds).size).toBe(26)

    const focusedAfterPagination = await participantClient.get(
      `${publicPath}/${feedback.publicId}`
    )
    expect(focusedAfterPagination).toHaveInertiaProps({
      focusedFeedbackId: feedback.publicId,
      'feedback.data.0.publicId': feedback.publicId
    })

    const filtered = await participantClient.get(
      `${publicPath}?category=bug&status=active&sort=newest&q=notification`
    )
    expect(filtered.data.props.feedback.data.length).toBe(1)
    expect(filtered).toHaveInertiaProps({
      'filters.category': 'bug',
      'filters.status': 'active',
      'filters.sort': 'newest',
      'filters.q': 'notification',
      'feedback.data.0.publicId': feedback.publicId
    })

    const missingPermalink = await participantClient.get(
      `${publicPath}/bfd_missing`
    )
    expect(missingPermalink).toHaveStatus(404)

    await socket.close()
  }
)

function bearingPath(project, environment, app) {
  return `/projects/${project.slug}/environments/${environment.slug}/apps/${app.slug}/bearing`
}

function visitPage(request, path) {
  return request.withHeaders(INERTIA_HEADERS).get(path)
}
