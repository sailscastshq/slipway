const fs = require('fs')
const path = require('path')

const { test } = require('sounding')

test(
  'Bridge renders the target app resource contract in the existing Slipway UI',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'bridge-contract-ui',
          name: 'Bridge Contract UI'
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
    const screenshotRoot = path.resolve(
      '.tmp/screenshots/issue-216-resource-contract'
    )

    fs.mkdirSync(screenshotRoot, { recursive: true })

    const contract = await sails.helpers.bridge.normalizeResourceContract.with({
      models: resourceMetadata(),
      config: resourceConfig()
    })
    const courseRecordId = '018f2a5c-7b34-7f8a-9c12-4a73b9d80211'
    const createdCourseRecordId = '018f2a5c-7b34-7f8a-9c12-4a73b9d80212'
    const records = [
      {
        id: courseRecordId,
        title: 'Build a production Sails app',
        published: true,
        createdAt: Date.UTC(2026, 6, 21, 9, 30)
      },
      {
        id: '018f2a5c-7b34-7f8a-9c12-4a73b9d80210',
        title: 'Own the deployment path',
        published: true,
        createdAt: Date.UTC(2026, 6, 18, 15, 10)
      },
      {
        id: '018f2a5c-7b34-7f8a-9c12-4a73b9d8020f',
        title: 'A legible cloud on one server',
        published: false,
        createdAt: Date.UTC(2026, 6, 12, 11, 5)
      }
    ]
    const record = {
      id: courseRecordId,
      title: 'Build a production Sails app',
      description:
        'A practical path from a Waterline model to a calm production release.',
      thumbnailUrl: 'https://cdn.example.com/courses/production-sails.webp',
      published: true,
      creator: 7
    }
    let persistedCourseRecord = record
    let createdValues
    let updatedValues

    await sails.models.app
      .updateOne({ id: app.id })
      .set({ status: 'running', containerName: 'bridge-contract-ui-web' })

    sails.helpers.bridge.introspectModels = async () => ({
      schemaVersion: contract.schemaVersion,
      discover: contract.discover,
      configured: contract.configured,
      models: contract.resources
    })
    sails.helpers.bridge.buildSailsWrapper = async (code) => code
    sails.helpers.bridge.executeInContainer = async (containerName, code) => {
      expect(containerName).toBe('bridge-contract-ui-web')

      if (code.includes('const counts = {};')) {
        return successfulResult({
          course: records.length,
          user: 1
        })
      }
      if (code.includes('const options = {};')) {
        return successfulResult({
          creator: [{ id: 7, label: 'Ada Lovelace' }]
        })
      }
      if (code.includes('const total = await model.count(where);')) {
        return successfulResult({
          records,
          total: records.length
        })
      }
      if (code.includes('await model.create(values).fetch();')) {
        createdValues = readEmbeddedValue(code, 'values')
        persistedCourseRecord = {
          id: createdCourseRecordId,
          ...createdValues
        }
        return successfulResult({ record: persistedCourseRecord })
      }
      if (code.includes('await model.updateOne(criteria).set(values);')) {
        updatedValues = readEmbeddedValue(code, 'values')
        persistedCourseRecord = {
          ...persistedCourseRecord,
          ...updatedValues
        }
        return successfulResult({ record: persistedCourseRecord })
      }
      if (code.includes('const record = await model.findOne(criteria)')) {
        if (code.includes('const identity = "user";')) {
          return successfulResult({
            record: {
              id: 7,
              fullName: 'Ada Lovelace',
              email: 'ada@example.com'
            }
          })
        }
        const criteria = readEmbeddedValue(code, 'criteria')
        return successfulResult({
          record:
            criteria.id === createdCourseRecordId
              ? persistedCourseRecord
              : record
        })
      }

      return {
        success: false,
        output: '',
        error: 'Unexpected Bridge query in UI trial.'
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
      await page.raw.setViewportSize({ width: 1440, height: 900 })

      const bridgePath = `/projects/${project.slug}/environments/${environment.slug}/bridge`
      const coursePath = `${bridgePath}/course`

      await page.goto(bridgePath)
      await page.wait('text=Courses')
      await expect(page).toSee('Content')
      await expect(page).toSee('People')
      await expect(page).toSee('2 resources')
      expect(await page.raw.getByText('Model Settings').count()).toBe(0)
      await page.screenshot(path.join(screenshotRoot, 'resources-light.png'), {
        fullPage: true
      })

      await page.raw.emulateMedia({ colorScheme: 'dark' })
      await page.screenshot(path.join(screenshotRoot, 'resources-dark.png'), {
        fullPage: true
      })
      await page.raw.emulateMedia({ colorScheme: 'light' })

      await page.goto(coursePath)
      await page.wait('text=Build a production Sails app')
      await expect(page).toSee('Course title')
      expect(await page.raw.locator('input[type="checkbox"]').count()).toBe(0)
      await page.screenshot(
        path.join(screenshotRoot, 'course-list-light.png'),
        {
          fullPage: true
        }
      )

      const actionsButton = page.raw.getByRole('button', {
        name: 'Actions for Build a production Sails app'
      })
      expect(await actionsButton.count()).toBe(1)
      await actionsButton.click()
      await expect(page).toSee('View record')
      await expect(page).toSee('Edit record')
      await expect(page).toSee('Delete record')
      await page.screenshot(
        path.join(screenshotRoot, 'course-actions-light.png'),
        {
          fullPage: true
        }
      )
      await page.raw.emulateMedia({ colorScheme: 'dark' })
      await page.screenshot(
        path.join(screenshotRoot, 'course-actions-dark.png'),
        {
          fullPage: true
        }
      )
      await page.raw.emulateMedia({ colorScheme: 'light' })
      await page.raw.keyboard.press('Escape')

      await page.goto(`${coursePath}/new`)
      await page.wait('text=Create Course')
      await expect(page).toSee('Course description')
      await expect(page).toSee('Thumbnail')
      await expect(page).toSee('Creator')
      const createRecordButton = page.raw.getByRole('button', {
        name: 'Create record'
      })
      expect(await createRecordButton.isDisabled()).toBe(true)
      await page.screenshot(
        path.join(screenshotRoot, 'course-create-light.png'),
        { fullPage: true }
      )
      await page.raw.getByLabel('Course title').fill('Ship a durable course')
      expect(await createRecordButton.isEnabled()).toBe(true)

      const descriptionEditor = page.raw.locator(
        '[data-test="bridge-course-description-visual-editor"]'
      )
      expect(await descriptionEditor.count()).toBe(1)
      expect(await descriptionEditor.getAttribute('aria-labelledby')).toBe(
        'bridge-course-description-label'
      )

      await descriptionEditor.click()
      await page.raw.keyboard.type('## ')
      await page.raw.keyboard.type('Ship with confidence')
      expect(await descriptionEditor.locator('h2').textContent()).toBe(
        'Ship with confidence'
      )
      await page.raw.keyboard.press('Enter')
      await page.raw.keyboard.type('Boring releases are good.')
      await page.raw.keyboard.press('Shift+Home')
      expect(
        (await page.script(() => window.getSelection().toString())).includes(
          'Boring releases are good.'
        )
      ).toBe(true)
      await page.wait('@bridge-course-description-format-menu')
      await page.screenshot(
        path.join(screenshotRoot, 'course-richtext-light.png'),
        { fullPage: true }
      )

      await page.raw.getByRole('button', { name: 'Bold', exact: true }).click()
      await page.raw
        .getByRole('button', {
          name: 'Edit Course description as Markdown'
        })
        .click()
      const descriptionSource = page.raw.locator(
        '[data-test="bridge-course-description-markdown-source"]'
      )
      expect(await descriptionSource.inputValue()).toContain(
        '**Boring releases are good.**'
      )
      const createdMarkdown = await descriptionSource.inputValue()
      await descriptionSource.fill(
        `${createdMarkdown}\n\n<script>alert('unsafe')</script>`
      )
      await expect(page).toSee(
        'Raw HTML is not allowed in Bridge Markdown fields.'
      )
      expect(await createRecordButton.isDisabled()).toBe(true)
      await page.screenshot(
        path.join(screenshotRoot, 'course-richtext-html-blocked.png'),
        { fullPage: true }
      )
      await descriptionSource.fill(createdMarkdown)
      expect(await createRecordButton.isEnabled()).toBe(true)

      await page.raw.emulateMedia({ colorScheme: 'dark' })
      await page.wait(100)
      await page.screenshot(
        path.join(screenshotRoot, 'course-richtext-source-dark.png'),
        { fullPage: true }
      )

      await page.raw
        .getByRole('button', {
          name: 'Edit Course description as Visual'
        })
        .click()
      await page.raw.emulateMedia({ colorScheme: 'dark' })
      await page.screenshot(
        path.join(screenshotRoot, 'course-richtext-dark.png'),
        { fullPage: true }
      )
      await page.raw.emulateMedia({ colorScheme: 'light' })

      await createRecordButton.click()
      await page.raw.waitForURL(
        (url) => url.pathname.endsWith(`/${createdCourseRecordId}`),
        { timeout: 10000 }
      )
      expect(createdValues.description).toBe(createdMarkdown)
      await expect(page).toSee('Ship a durable course')

      await page.goto(`${coursePath}/${createdCourseRecordId}/edit`)
      await page.wait('text=Edit Course')
      await page.raw
        .getByRole('button', {
          name: 'Edit Course description as Markdown'
        })
        .click()
      const persistedDescriptionSource = page.raw.locator(
        '[data-test="bridge-course-description-markdown-source"]'
      )
      expect(await persistedDescriptionSource.inputValue()).toBe(
        createdMarkdown
      )
      const updatedMarkdown = `${createdMarkdown}\n\nA safe production update.`
      await persistedDescriptionSource.fill(updatedMarkdown)
      await page.raw
        .getByRole('button', {
          name: 'Edit Course description as Visual'
        })
        .click()

      await page.raw.setViewportSize({ width: 390, height: 844 })
      expect(
        await page.script(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      ).toBe(true)
      await page.screenshot(
        path.join(screenshotRoot, 'course-richtext-mobile.png'),
        { fullPage: true }
      )
      await page.raw.getByRole('button', { name: 'Save changes' }).click()
      await page.raw.waitForURL(
        (url) => url.pathname.endsWith(`/${createdCourseRecordId}`),
        { timeout: 10000 }
      )
      expect(updatedValues.description).toBe(updatedMarkdown)

      await page.raw.setViewportSize({ width: 1440, height: 900 })
      await page.goto(`${coursePath}/${createdCourseRecordId}/edit`)
      await page.wait('text=Edit Course')
      await page.raw
        .getByRole('button', {
          name: 'Edit Course description as Markdown'
        })
        .click()
      expect(
        await page.raw
          .locator('[data-test="bridge-course-description-markdown-source"]')
          .inputValue()
      ).toBe(updatedMarkdown)

      await page.goto(`${coursePath}/${courseRecordId}`)
      await page.wait('text=A practical path')
      await expect(page).toSee('Course description')
      await expect(page).toSee('Thumbnail')
      await page.raw.emulateMedia({ colorScheme: 'dark' })
      await page.screenshot(
        path.join(screenshotRoot, 'course-record-dark.png'),
        {
          fullPage: true
        }
      )

      await page.raw.emulateMedia({ colorScheme: 'light' })
      await page.goto(`${bridgePath}/user/7`)
      await page.wait('text=Ada Lovelace')
      await expect(page).toSee('ada@example.com')
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

function resourceConfig() {
  return {
    schemaVersion: 1,
    resources: {
      course: {
        label: 'Courses',
        singularLabel: 'Course',
        group: 'Content',
        title: 'title',
        search: ['title'],
        list: ['title', 'published', 'createdAt'],
        show: [
          'id',
          'title',
          'description',
          'thumbnailUrl',
          'published',
          'creator'
        ],
        create: [
          'title',
          'description',
          'thumbnailUrl',
          'published',
          'creator'
        ],
        edit: ['title', 'description', 'thumbnailUrl', 'published', 'creator'],
        sort: {
          field: 'createdAt',
          direction: 'DESC'
        },
        actions: {
          bulkDelete: false
        },
        fields: {
          title: {
            label: 'Course title',
            placeholder: 'A clear, specific course title'
          },
          description: {
            label: 'Course description',
            type: 'richtext',
            format: 'markdown',
            help: 'The public description shown on the course page.'
          },
          thumbnailUrl: {
            label: 'Thumbnail',
            type: 'upload',
            placeholder: 'https://cdn.example.com/courses/thumbnail.webp',
            upload: {
              kind: 'image',
              storage: 'bridge',
              directory: 'courses/thumbnails',
              store: 'url'
            }
          },
          creator: {
            label: 'Creator'
          }
        }
      },
      user: {
        label: 'People',
        singularLabel: 'Person',
        group: 'People',
        title: 'fullName',
        search: ['fullName', 'email'],
        list: ['fullName', 'email'],
        show: ['id', 'fullName', 'email'],
        create: ['fullName', 'email'],
        edit: ['fullName', 'email'],
        actions: {
          delete: false,
          bulkDelete: false
        }
      }
    }
  }
}

function resourceMetadata() {
  return {
    course: {
      identity: 'course',
      globalId: 'Course',
      tableName: 'course',
      primaryKey: 'id',
      attributes: {
        id: {
          type: 'string',
          required: true
        },
        title: {
          type: 'string',
          required: true
        },
        description: {
          type: 'string',
          columnType: 'text'
        },
        thumbnailUrl: {
          type: 'string'
        },
        published: {
          type: 'boolean',
          defaultsTo: false
        },
        createdAt: {
          type: 'number',
          autoCreatedAt: true
        },
        updatedAt: {
          type: 'number',
          autoUpdatedAt: true
        },
        creator: {
          type: 'number',
          model: 'user'
        }
      },
      associations: [
        {
          alias: 'creator',
          type: 'model',
          model: 'user'
        }
      ]
    },
    user: {
      identity: 'user',
      globalId: 'User',
      tableName: 'users',
      primaryKey: 'id',
      attributes: {
        id: {
          type: 'number',
          autoIncrement: true
        },
        fullName: {
          type: 'string',
          required: true
        },
        email: {
          type: 'string',
          isEmail: true,
          required: true
        },
        createdAt: {
          type: 'number',
          autoCreatedAt: true
        }
      },
      associations: []
    }
  }
}
