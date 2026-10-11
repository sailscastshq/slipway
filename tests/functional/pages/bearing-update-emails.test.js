const { test } = require('sounding')
const assert = require('node:assert/strict')
const {
  INERTIA_HEADERS,
  withCsrfFromPage
} = require('../../support/csrf-request')
const mail = require('../../../api/lib/bearing-update-mail')

test(
  'Bearing customer consent and unsubscribe require the correct app and safe mutations',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'email-preference-contract' } }
    }
  },
  async ({ sails, world, request, expect }) => {
    const current = world.current
    const app = current.apps.web
    const environment = current.environments.production
    const project = current.projects.deploymentTarget
    await App.updateOne({ id: app.id }).set({ bearingEnabled: true })
    await Environment.updateOne({ id: environment.id }).set({
      domain: 'emails.example.test'
    })
    const secret = await sails.helpers.bearing.ensureAppSecret.with({
      appId: String(app.id),
      rotate: true
    })
    const space = await BearingSpace.create({
      publicSlug: 'email-preference-contract',
      app: app.id,
      createdBy: current.users.genesisUser.id
    }).fetch()
    const base = `/_slipway/bearing/host/${project.slug}/${environment.slug}/${app.slug}`
    const guest = request.withHeaders({
      ...INERTIA_HEADERS,
      host: 'emails.example.test',
      'x-forwarded-host': 'emails.example.test'
    })
    const guestCsrf = await withCsrfFromPage(guest, `${base}/updates`)
    expect(
      await guestCsrf.request.post(`${base}/update-email-preference`, {
        enabled: true
      })
    ).toHaveStatus(403)
    expect(
      await guest
        .as('genesisUser')
        .post(`${base}/update-email-preference`, { enabled: true })
    ).toHaveStatus(403)
    async function exchange(email) {
      const response = await request
        .withHeaders({
          authorization: `Bearer ${secret}`,
          accept: 'application/json'
        })
        .post('/api/v1/bearing/exchange', {
          appId: String(app.id),
          surface: 'updates',
          embedded: true,
          hostUser: {
            id: 'synthetic-email-customer',
            email,
            emailVerified: true,
            fullName: 'Synthetic Customer'
          }
        })
      expect(response).toHaveStatus(201)
      const url = new URL(response.data.launchUrl)
      assert.equal(url.searchParams.get('surface'), 'updates')
      assert.equal(url.searchParams.get('embedded'), '1')
      const launch = await request.get(url.pathname + url.search)
      expect(launch).toRedirectTo('/bearing/updates?embedded=1')
      return guest.withSession(launch.session)
    }
    let client = await exchange('synthetic@example.test')
    let csrf = await withCsrfFromPage(client, `${base}/updates`)
    assert.equal(csrf.page.data.props.emailSubscribed, false)
    assert.doesNotMatch(
      JSON.stringify(csrf.page.data.props),
      /synthetic@example\.test/
    )
    expect(
      await client.post(`${base}/update-email-preference`, { enabled: true })
    ).toHaveStatus(403)
    expect(
      await csrf.request.post(`${base}/update-email-preference`, {
        enabled: true
      })
    ).toHaveStatus(303)
    expect(
      await csrf.request.post(`${base}/update-email-preference`, {
        enabled: true
      })
    ).toHaveStatus(303)
    assert.equal(await BearingUpdateConsent.count({ space: space.id }), 1)
    const consent = await BearingUpdateConsent.findOne({ space: space.id })
    const token = mail.token(consent, sails.config.session.secret)
    const url = `${base}/unsubscribe?token=${encodeURIComponent(token)}`
    const confirm = await withCsrfFromPage(guest, url)
    assert.equal(confirm.page.data.props.done, false)
    assert.equal((await mail.latest(consent.participant)).state, 'on')
    assert.doesNotMatch(
      JSON.stringify(confirm.page.data.props),
      new RegExp(token.replace('.', '\\.'))
    )
    expect(await guest.get(`${base}/unsubscribe?token=${token}x`)).toHaveStatus(
      404
    )
    expect(
      await guest.get(
        `${base.replace(
          `/${app.slug}`,
          '/other-app'
        )}/unsubscribe?token=${token}`
      )
    ).toHaveStatus(404)
    expect(await guest.post(url, { token })).toHaveStatus(403)
    expect(await confirm.request.post(url, { token })).toHaveStatus(200)
    expect(await confirm.request.post(url, { token })).toHaveStatus(200)
    assert.equal(await BearingUpdateConsent.count({ space: space.id }), 2)
    assert.equal((await mail.latest(consent.participant)).state, 'off')
    csrf = await withCsrfFromPage(client, `${base}/updates`)
    await csrf.request.post(`${base}/update-email-preference`, {
      enabled: true
    })
    client = await exchange('changed@example.test')
    assert.equal(
      (await client.get(`${base}/updates`)).data.props.emailSubscribed,
      false
    )
    client = await exchange('synthetic@example.test')
    assert.equal(
      (await client.get(`${base}/updates`)).data.props.emailSubscribed,
      false
    )
  }
)

test(
  'all three publish paths atomically record one frozen event and draft saves record none',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'email-publication-contract' } }
    }
  },
  async ({ world, request, expect }) => {
    const current = world.current
    const app = current.apps.web
    const project = current.projects.deploymentTarget
    const environment = current.environments.production
    const space = await BearingSpace.create({
      publicSlug: 'email-publication-contract',
      app: app.id,
      createdBy: current.users.genesisUser.id
    }).fetch()
    const base = `/projects/${project.slug}/environments/${environment.slug}/apps/${app.slug}/bearing`
    const manager = await withCsrfFromPage(
      request,
      `${base}?view=updates`,
      'genesisUser'
    )
    const values = {
      title: 'Synthetic complete update',
      excerpt: 'Synthetic summary',
      body: '# Complete content\n\nThe final line.'
    }
    await manager.request.post(`${base}/updates`, { ...values, publish: true })
    assert.equal(await BearingUpdatePublication.count({ space: space.id }), 1)
    for (const mode of ['patch', 'publish']) {
      await manager.request.post(`${base}/updates`, {
        ...values,
        title: mode,
        publish: false
      })
      const draft = await BearingUpdate.findOne({
        space: space.id,
        status: 'draft'
      })
      assert.equal(
        await BearingUpdatePublication.count({ bearingUpdate: draft.id }),
        0
      )
      const target = `${base}/updates/${draft.publicId}`
      if (mode === 'patch')
        await manager.request.patch(target, { ...values, publish: true })
      else await manager.request.post(`${target}/publish`)
      const publication = await BearingUpdatePublication.findOne({
        bearingUpdate: draft.id
      })
      assert.equal(publication.snapshot.body, values.body)
      assert.equal(publication.consentWatermark, 0)
      await manager.request.post(`${target}/publish`)
      await manager.request.patch(target, {
        ...values,
        body: 'An edit',
        publish: true
      })
      assert.equal(
        await BearingUpdatePublication.count({ bearingUpdate: draft.id }),
        1
      )
      assert.equal(
        (await BearingUpdatePublication.findOne({ id: publication.id }))
          .snapshot.body,
        values.body
      )
    }
    assert.equal(await BearingUpdatePublication.count({ space: space.id }), 3)
  }
)
