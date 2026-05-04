const fs = require('fs')
const os = require('os')
const path = require('path')

const { test } = require('sounding')

test('static model parsing removes default timestamp attributes explicitly set to false', async ({
  sails,
  expect
}) => {
  const { models } = await withStaticProject(
    sails,
    {
      'config/models.js': defaultConfigModels({
        createdAtColumn: 'createdAt',
        updatedAtColumn: 'updatedAt'
      }),
      'api/models/Widget.js': `module.exports = {
        attributes: {
          name: {
            type: 'string',
            required: true,
          },
          createdAt: false,
          updatedAt: false,
        },
      }`
    },
    async (projectSlug) => sails.helpers.dock.getModelsStatic(projectSlug)
  )

  expect(models.widget.attributes).toEqual({
    id: {
      type: 'number',
      autoIncrement: true,
      columnName: 'id'
    },
    name: {
      columnName: 'name',
      type: 'string',
      required: true
    }
  })
})

test('static model parsing only treats top-level false attributes as disabled columns', async ({
  sails,
  expect
}) => {
  const { models } = await withStaticProject(
    sails,
    {
      'config/models.js': defaultConfigModels({
        createdAt: false,
        updatedAtColumn: 'updatedAt'
      }),
      'api/models/Profile.js': `module.exports = {
        attributes: {
          profile: {
            type: 'json',
            defaultsTo: {
              public: false,
            },
          },
          updatedAt: false,
        },
      }`
    },
    async (projectSlug) => sails.helpers.dock.getModelsStatic(projectSlug)
  )

  expect(models.profile.attributes.profile).toEqual({
    columnName: 'profile',
    type: 'json'
  })
  expect(models.profile.attributes.updatedAt).toBe(undefined)
})

test('static model parsing preserves configured snake_case timestamp and column names', async ({
  sails,
  expect
}) => {
  const { models } = await withStaticProject(
    sails,
    {
      'config/models.js': defaultConfigModels({
        createdAtColumn: 'created_at',
        updatedAtColumn: 'updated_at'
      }),
      'api/models/App.js': `module.exports = {
        tableName: 'apps',
        attributes: {
          dockerfilePath: {
            type: 'string',
            defaultsTo: 'Dockerfile',
            columnName: 'dockerfile_path',
          },
        },
      }`
    },
    async (projectSlug) => sails.helpers.dock.getModelsStatic(projectSlug)
  )

  expect(models.app.attributes.createdAt.columnName).toBe('created_at')
  expect(models.app.attributes.updatedAt.columnName).toBe('updated_at')
  expect(models.app.attributes.dockerfilePath.columnName).toBe(
    'dockerfile_path'
  )
})

async function withStaticProject(sails, files, callback) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'slipway-models-'))
  const projectSlug = 'demo'
  const projectRoot = path.join(tmpRoot, projectSlug)
  const originalAppsDir = sails.config.custom.slipwayAppsDir

  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const filePath = path.join(projectRoot, relativePath)
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      fs.writeFileSync(filePath, content)
    }

    sails.config.custom.slipwayAppsDir = tmpRoot
    return await callback(projectSlug)
  } finally {
    sails.config.custom.slipwayAppsDir = originalAppsDir
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  }
}

function defaultConfigModels({
  createdAt = true,
  createdAtColumn,
  updatedAt = true,
  updatedAtColumn
}) {
  const attributes = [
    `id: {
      type: 'number',
      autoIncrement: true,
      columnName: 'id'
    }`
  ]

  if (createdAtColumn) {
    attributes.push(`createdAt: {
      type: 'number',
      autoCreatedAt: true,
      columnName: '${createdAtColumn}'
    }`)
  }

  if (updatedAtColumn) {
    attributes.push(`updatedAt: {
      type: 'number',
      autoUpdatedAt: true,
      columnName: '${updatedAtColumn}'
    }`)
  }

  return `module.exports.models = {
    archiveModelIdentity: false,
    createdAt: ${createdAt},
    updatedAt: ${updatedAt},
    attributes: {
      ${attributes.join(',\n')}
    }
  }`
}
