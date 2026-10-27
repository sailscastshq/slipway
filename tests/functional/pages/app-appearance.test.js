const assert = require('node:assert/strict')
const { test } = require('sounding')
const { withCsrfFromPage } = require('../../support/csrf-request')
const contract = require('../../../api/lib/app-appearance')
const brands = require('../../fixtures/appearance/brands.json')
const fs = require('node:fs')
const path = require('node:path')
test(
  'App appearance authorizes each app and shares only public validated branding',
  {
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: { slug: 'appearance-security', name: 'Original name' }
      }
    }
  },
  async ({ sails, world, request, visit, expect }) => {
    const create = world.create.bind(world)
    const current = world.current,
      app = current.apps.web,
      environment = current.environments.production,
      project = current.projects.deploymentTarget
    const base = `/projects/${project.slug}/environments/${environment.slug}/apps/${app.slug}`
    const other = await create('app').with({
      name: 'Other app',
      slug: 'other',
      environment: environment.id
    })
    const appearance = {
      ...contract.normalize(),
      ...brands.tembo,
      mode: 'host',
      logoLight:
        'data:image/png;base64,' +
        fs
          .readFileSync(
            path.resolve('tests/fixtures/appearance/tembo-logo.png')
          )
          .toString('base64'),
      logoDark: null
    }
    const browser = await withCsrfFromPage(
      request,
      `${base}/appearance`,
      'genesisUser'
    )
    expect(browser.page).toHaveInertiaProp('appearance.configured', false)
    const saved = await browser.request.patch(`${base}/appearance`, {
      appearance
    })
    expect(saved).toHaveStatus(303)
    const reloaded = await visit.as('genesisUser')(`${base}/appearance`)
    expect(reloaded).toHaveInertiaProp('appearance.displayName', 'Tembo')
    expect(reloaded).toHaveInertiaProp('appearance.mode', 'host')
    assert.equal(JSON.stringify(reloaded.data).includes('base64'), false)
    const untouched = await visit.as('genesisUser')(
      `/projects/${project.slug}/environments/${environment.slug}/apps/${other.slug}/appearance`
    )
    expect(untouched).toHaveInertiaProp('appearance.configured', false)
    assert.equal(untouched.data.props.appearance.logoLight, null)
    const invalid = await browser.request.patch(`${base}/appearance`, {
      appearance: { ...appearance, css: 'body{display:none}' }
    })
    expect(invalid).toHaveStatus(400)
    const crossLogo = await browser.request.patch(`${base}/appearance`, {
      appearance: {
        ...appearance,
        logoLight: reloaded.data.props.appearance.logoLight
      }
    })
    expect(crossLogo).toHaveStatus(400)
    const member = await create('user').with({
      team: current.teams.genesisTeam.id,
      teamRole: 'member'
    })
    const forbidden = await visit.as(member)(`${base}/appearance`)
    expect(forbidden).toHaveStatus(403)
    const foreign = await create('project').with({
      slug: 'foreign-brand',
      team: (
        await create('team').with({ owner: current.users.genesisUser.id })
      ).id,
      createdBy: current.users.genesisUser.id
    })
    expect(
      await visit.as('genesisUser')(
        `/projects/${foreign.slug}/environments/${environment.slug}/apps/${app.slug}/appearance`
      )
    ).toHaveStatus(404)
    await sails.models.app
      .updateOne({ id: app.id })
      .set({ bearingEnabled: true })
    await sails.models.bearingspace.create({
      app: app.id,
      publicSlug: 'appearance-secure',
      createdBy: current.users.genesisUser.id,
      widgetEnabled: true
    })
    const publicBase = `/_slipway/bearing/host/${project.slug}/${environment.slug}/${app.slug}`
    const config = await request.get(`${publicBase}/widget-config`)
    expect(config).toHaveStatus(200)
    assert.equal(config.data.appName, 'Tembo')
    assert.equal(JSON.stringify(config.data).includes('base64'), false)
    assert.equal(JSON.stringify(config.data).includes('Secret'), false)
    const page = await visit(
      `${publicBase}/feedback?embedded=1&appearanceMode=dark`
    )
    expect(page).toHaveInertiaProp('appearance.resolvedMode', 'dark')
    const css = await request.get(`${publicBase}/feedback/_/appearance.css`)
    expect(css).toHaveStatus(200)
    assert.ok(String(css.body).includes('#fbf8f3'))
    const logo = await request.get(
      `${publicBase}/feedback/_/appearance/logo/light`
    )
    expect(logo).toHaveStatus(200)
    assert.ok(logo.header('content-type').includes('image/webp'))
    await sails.models.setting
      .updateOne({ key: `app-appearance:v1:${app.id}` })
      .set({ value: 'null' })
    expect(
      await visit.as('genesisUser')(`${base}/appearance`)
    ).toHaveInertiaProp('appearance.configured', false)
    const blank = await browser.request.patch(`${base}/appearance`, {
      appearance: {
        ...appearance,
        displayName: '',
        logoLight: null,
        logoDark: null
      }
    })
    expect(blank).toHaveStatus(303)
    expect(
      await visit.as('genesisUser')(`${base}/appearance`)
    ).toHaveInertiaProp('appearance.displayName', project.name)
    const reset = await browser.request.patch(`${base}/appearance`, {
      reset: true
    })
    expect(reset).toHaveStatus(303)
    await sails.models.setting.create({
      key: `app-appearance:v1:${other.id}`,
      value: '{}'
    })
    await sails.models.app.destroyOne({ id: other.id })
    assert.equal(
      await sails.models.setting.count({
        key: `app-appearance:v1:${other.id}`
      }),
      0
    )
    expect(
      await visit.as('genesisUser')(`${base}/appearance`)
    ).toHaveInertiaProp('appearance.configured', false)
    assert.equal(
      await sails.models.setting.count({ key: `app-appearance:v1:${app.id}` }),
      0
    )
  }
)
