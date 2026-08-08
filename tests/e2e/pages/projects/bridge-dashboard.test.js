const fs = require('fs')
const path = require('path')

const { test } = require('sounding')

test(
  'Bridge renders an authorized target-app dashboard in the minimal Slipway UI',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'bridge-dashboard-ui',
          name: 'Bridge Dashboard UI'
        }
      }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current
    const app = current.apps.web
    const environment = current.environments.production
    const project = current.projects.deploymentTarget
    const originalIntrospectModels = sails.helpers.bridge.introspectModels
    const originalBuildSailsWrapper = sails.helpers.bridge.buildSailsWrapper
    const originalExecuteInContainer = sails.helpers.bridge.executeInContainer
    const screenshotRoot = path.resolve('.tmp/screenshots/issue-222-dashboard')
    fs.mkdirSync(screenshotRoot, { recursive: true })
    let salesUnavailable = false

    const contract = await sails.helpers.bridge.normalizeResourceContract.with({
      models: modelMetadata(),
      config: dashboardConfig()
    })

    await sails.models.app.updateOne({ id: app.id }).set({
      status: 'running',
      containerName: 'bridge-dashboard-ui-web'
    })
    sails.helpers.bridge.introspectModels = async () => ({
      schemaVersion: contract.schemaVersion,
      discover: contract.discover,
      configured: contract.configured,
      models: contract.resources,
      dashboards: contract.dashboards
    })
    sails.helpers.bridge.buildSailsWrapper = async (code) => code
    sails.helpers.bridge.executeInContainer = async (containerName, code) => {
      expect(containerName).toBe('bridge-dashboard-ui-web')

      if (code.includes('const decisions = Object.create(null);')) {
        const requests = readEmbeddedValue(code, 'requests')
        const decisions = {}
        for (const request of requests) {
          decisions[request.key] = decisions[request.key] || {}
          decisions[request.key][request.action] = true
        }
        return successfulResult(decisions)
      }
      if (code.includes('const dashboard =')) {
        return successfulResult([
          { id: 'users', value: 1248 },
          { id: 'courses', value: 42 },
          { id: 'chapters', value: 74 },
          { id: 'lessons', value: 286 },
          salesUnavailable
            ? {
                id: 'sales',
                error: 'Sales data is temporarily unavailable.'
              }
            : {
                id: 'sales',
                value: 1,
                detail: 'Completed purchases'
              },
          {
            id: 'recentLessons',
            records: [
              {
                id: 91,
                title: 'Make production failures boring',
                createdAt: Date.UTC(2026, 6, 27, 10, 15)
              },
              {
                id: 90,
                title: 'A legible release boundary',
                createdAt: Date.UTC(2026, 6, 26, 15, 40)
              },
              {
                id: 89,
                title: 'The server is raw land',
                createdAt: Date.UTC(2026, 6, 25, 8, 5)
              }
            ]
          },
          {
            id: 'recentSignups',
            records: [
              {
                id: 301,
                fullName: 'Ada Lovelace',
                email: 'ada@example.com',
                createdAt: Date.UTC(2026, 6, 27, 11, 30)
              },
              {
                id: 300,
                fullName: 'Grace Hopper',
                email: 'grace@example.com',
                createdAt: Date.UTC(2026, 6, 26, 18, 20)
              }
            ]
          },
          { id: 'newCourse' },
          { id: 'newChapter' },
          { id: 'newLesson' },
          {
            id: 'signupTrend',
            points: [
              { label: 'Mon', value: 18 },
              { label: 'Tue', value: 26 },
              { label: 'Wed', value: 21 },
              { label: 'Thu', value: 34 },
              { label: 'Fri', value: 41 },
              { label: 'Sat', value: 37 },
              { label: 'Sun', value: 52 }
            ]
          },
          {
            id: 'lessonStatus',
            segments: [
              { label: 'Published', value: 214 },
              { label: 'Draft', value: 58 },
              { label: 'Review', value: 14 }
            ]
          }
        ])
      }
      if (code.includes('const counts = {};')) {
        return successfulResult({
          user: 1248,
          course: 42,
          chapter: 74,
          lesson: 286
        })
      }
      return {
        success: false,
        output: '',
        error: 'Unexpected Bridge dashboard execution.',
        exitCode: 1
      }
    }

    try {
      await page.raw.route('**/api/v1/system/check-update', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ updateAvailable: false })
        })
      })
      await login.withPassword('genesisUser', page, {
        password: current.auth.genesisUserPassword
      })
      await page.raw.waitForURL((url) => !url.pathname.startsWith('/login'), {
        timeout: 10000
      })

      const bridgePath = `/projects/${project.slug}/environments/${environment.slug}/bridge`
      await page.goto(bridgePath)
      await page.wait('text=Content overview')

      await expect(page).toSee('Total users')
      await expect(page).toSee('1,248')
      await expect(page).toSee('42')
      await expect(page).toSee('74')
      await expect(page).toSee('286')
      await expect(page).toSee('Completed purchases')
      await expect(page).toSee('Make production failures boring')
      await expect(page).toSee('Ada Lovelace')
      const recentLessonLink = page.raw.getByRole('link', {
        name: /Make production failures boring/
      })
      expect(await recentLessonLink.getAttribute('href')).toBe(
        `${bridgePath}/lesson/91`
      )
      const viewAllLinks = page.raw.getByRole('link', { name: 'View all' })
      expect(await viewAllLinks.nth(0).getAttribute('href')).toBe(
        `${bridgePath}/lesson`
      )
      expect(await viewAllLinks.nth(1).getAttribute('href')).toBe(
        `${bridgePath}/user`
      )

      await recentLessonLink.click()
      await page.raw.waitForURL(
        (url) => url.pathname === `${bridgePath}/lesson/91`
      )
      await expect(page).not.toSee('Not Found')
      await page.goto(bridgePath)
      await page.wait('text=Content overview')

      await page.raw.getByRole('link', { name: 'View all' }).nth(0).click()
      await page.raw.waitForURL(
        (url) => url.pathname === `${bridgePath}/lesson`
      )
      await expect(page).not.toSee('Not Found')
      await page.goto(bridgePath)
      await page.wait('text=Content overview')

      const metricCards = page.raw.locator('[data-bridge-metric-card]')
      expect(await metricCards.count()).toBe(5)
      const metricCardBoxes = await metricCards.evaluateAll((cards) =>
        cards.map((card) => {
          const box = card.getBoundingClientRect()
          return {
            top: Math.round(box.top),
            width: Math.round(box.width),
            backgroundColor: window.getComputedStyle(card).backgroundColor
          }
        })
      )
      expect(new Set(metricCardBoxes.map((card) => card.top)).size).toBe(1)
      expect(metricCardBoxes.every((card) => card.width >= 150)).toBe(true)
      expect(
        metricCardBoxes.every(
          (card) => card.backgroundColor !== 'rgba(0, 0, 0, 0)'
        )
      ).toBe(true)
      expect(
        await page.raw.getByRole('button', { name: 'Quick actions' }).count()
      ).toBe(1)
      expect(
        await page.raw.getByRole('menuitem', { name: 'New Course' }).count()
      ).toBe(0)

      await page.raw.getByRole('button', { name: 'Quick actions' }).click()
      await page.raw.getByRole('menu').waitFor()
      expect(
        await page.raw
          .getByRole('menuitem', { name: 'New Course' })
          .getAttribute('href')
      ).toBe(`${bridgePath}/course/new`)
      expect(
        await page.raw
          .getByRole('menuitem', { name: 'New Chapter' })
          .getAttribute('href')
      ).toBe(`${bridgePath}/chapter/new`)
      expect(
        await page.raw
          .getByRole('menuitem', { name: 'New Lesson' })
          .getAttribute('href')
      ).toBe(`${bridgePath}/lesson/new`)
      await page.screenshot(
        path.join(screenshotRoot, 'quick-actions-light.png'),
        {
          fullPage: true
        }
      )
      await page.raw.keyboard.press('Escape')
      expect(await page.raw.getByRole('menu').count()).toBe(0)
      await page.raw
        .getByRole('button', { name: 'Quick actions' })
        .evaluate((button) => button.blur())
      await page.raw.getByRole('button', { name: 'Quick actions' }).click()
      await page.raw.getByRole('menuitem', { name: 'New Lesson' }).click()
      await page.raw.waitForURL(
        (url) => url.pathname === `${bridgePath}/lesson/new`
      )
      await expect(page).not.toSee('Not Found')
      await page.goto(bridgePath)
      await page.wait('text=Content overview')

      await page.screenshot(path.join(screenshotRoot, 'dashboard-light.png'), {
        fullPage: true
      })
      await page.raw.emulateMedia({ colorScheme: 'dark' })
      await page.raw.waitForTimeout(400)
      await page.screenshot(path.join(screenshotRoot, 'dashboard-dark.png'), {
        fullPage: true
      })
      await page.raw.getByRole('button', { name: 'Quick actions' }).click()
      await page.raw.getByRole('menu').waitFor()
      await page.screenshot(
        path.join(screenshotRoot, 'quick-actions-dark.png'),
        {
          fullPage: true
        }
      )
      await page.raw.keyboard.press('Escape')
      await page.raw
        .getByRole('button', { name: 'Quick actions' })
        .evaluate((button) => button.blur())
      await page.raw.emulateMedia({ colorScheme: 'light' })
      await page.raw.waitForTimeout(400)
      await page.resize(390, 844)
      const mobileMetricCardBoxes = await metricCards.evaluateAll((cards) =>
        cards.map((card) => {
          const box = card.getBoundingClientRect()
          return {
            left: Math.round(box.left),
            width: Math.round(box.width)
          }
        })
      )
      expect(new Set(mobileMetricCardBoxes.map((card) => card.left)).size).toBe(
        1
      )
      expect(mobileMetricCardBoxes.every((card) => card.width >= 320)).toBe(
        true
      )
      await page.screenshot(path.join(screenshotRoot, 'dashboard-mobile.png'), {
        fullPage: true
      })
      await page.raw.locator('[data-bridge-metric-grid]').screenshot({
        path: path.join(screenshotRoot, 'metric-cards-mobile.png')
      })
      await page.raw.getByRole('button', { name: 'Quick actions' }).click()
      await page.raw.getByRole('menu').waitFor()
      await page.screenshot(
        path.join(screenshotRoot, 'quick-actions-mobile.png'),
        {
          fullPage: true
        }
      )
      await page.raw.keyboard.press('Escape')

      salesUnavailable = true
      await page.raw.getByRole('button', { name: 'Refresh Bridge' }).click()
      const unavailableSalesCard = page.raw.locator(
        '[data-bridge-metric-card="sales"]'
      )
      await unavailableSalesCard.getByText('Unavailable').waitFor()
      expect(await unavailableSalesCard.getByText('—').count()).toBe(1)
    } finally {
      sails.helpers.bridge.introspectModels = originalIntrospectModels
      sails.helpers.bridge.buildSailsWrapper = originalBuildSailsWrapper
      sails.helpers.bridge.executeInContainer = originalExecuteInContainer
    }
  }
)

function successfulResult(output) {
  return {
    success: true,
    output: JSON.stringify(output),
    error: null,
    exitCode: 0
  }
}

function readEmbeddedValue(code, name) {
  const match = code.match(new RegExp(`const ${name} = (.*);`))
  if (!match) throw new Error(`Missing ${name} declaration in Bridge query.`)
  return JSON.parse(match[1])
}

function dashboardConfig() {
  return {
    discover: false,
    resources: {
      user: {
        label: 'Users',
        title: 'fullName',
        list: ['fullName', 'email', 'createdAt']
      },
      course: {
        label: 'Courses',
        title: 'title',
        list: ['title', 'published', 'createdAt']
      },
      chapter: {
        label: 'Chapters',
        title: 'title',
        list: ['title', 'createdAt']
      },
      lesson: {
        label: 'Lessons',
        title: 'title',
        list: ['title', 'published', 'createdAt']
      }
    },
    dashboard: {
      label: 'Content overview',
      description: 'The content and audience signals that need attention.',
      cards: {
        users: {
          type: 'metric',
          label: 'Total users',
          resource: 'user'
        },
        courses: {
          type: 'metric',
          label: 'Courses',
          resource: 'course'
        },
        chapters: {
          type: 'metric',
          label: 'Chapters',
          resource: 'chapter'
        },
        lessons: {
          type: 'metric',
          label: 'Lessons',
          resource: 'lesson'
        },
        sales: {
          type: 'custom',
          label: 'Sales',
          helper: 'bridge.dashboard.sales'
        },
        recentLessons: {
          type: 'recent',
          label: 'Recent lessons',
          resource: 'lesson',
          fields: ['title', 'createdAt'],
          limit: 3
        },
        recentSignups: {
          type: 'recent',
          label: 'Recent signups',
          resource: 'user',
          fields: ['fullName', 'email', 'createdAt'],
          limit: 3
        },
        newCourse: {
          type: 'action',
          label: 'New Course',
          resource: 'course'
        },
        newChapter: {
          type: 'action',
          label: 'New Chapter',
          resource: 'chapter'
        },
        newLesson: {
          type: 'action',
          label: 'New Lesson',
          resource: 'lesson'
        },
        signupTrend: {
          type: 'trend',
          label: 'Signups this week',
          resource: 'user',
          helper: 'bridge.dashboard.signups'
        },
        lessonStatus: {
          type: 'partition',
          label: 'Lesson status',
          resource: 'lesson',
          helper: 'bridge.dashboard.lessonStatus'
        }
      }
    }
  }
}

function modelMetadata() {
  return {
    user: model('user', 'User', {
      id: { type: 'number', autoIncrement: true },
      fullName: { type: 'string', required: true },
      email: { type: 'string', required: true, isEmail: true },
      createdAt: { type: 'number', autoCreatedAt: true }
    }),
    course: model('course', 'Course', {
      id: { type: 'number', autoIncrement: true },
      title: { type: 'string', required: true },
      published: { type: 'boolean', defaultsTo: false },
      createdAt: { type: 'number', autoCreatedAt: true }
    }),
    chapter: model('chapter', 'Chapter', {
      id: { type: 'number', autoIncrement: true },
      title: { type: 'string', required: true },
      createdAt: { type: 'number', autoCreatedAt: true }
    }),
    lesson: model('lesson', 'Lesson', {
      id: { type: 'number', autoIncrement: true },
      title: { type: 'string', required: true },
      published: { type: 'boolean', defaultsTo: false },
      createdAt: { type: 'number', autoCreatedAt: true }
    })
  }
}

function model(identity, globalId, attributes) {
  return {
    identity,
    globalId,
    tableName: identity,
    primaryKey: 'id',
    attributes,
    associations: []
  }
}
