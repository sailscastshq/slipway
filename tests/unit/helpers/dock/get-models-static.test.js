const { test } = require('sounding')

const getModelsStatic = require('../../../../api/helpers/dock/get-models-static')

const { parseModelFile } = getModelsStatic._private

test('static model parsing removes default timestamp attributes explicitly set to false', async ({ expect }) => {
  const parsed = parseModelFile(
    `module.exports = {
      attributes: {
        name: {
          type: 'string',
          required: true,
        },
        createdAt: false,
        updatedAt: false,
      },
    }`,
    'Widget.js',
    {
      id: {
        type: 'number',
        autoIncrement: true,
        columnName: 'id',
      },
      createdAt: {
        type: 'number',
        autoCreatedAt: true,
        columnName: 'createdAt',
      },
      updatedAt: {
        type: 'number',
        autoUpdatedAt: true,
        columnName: 'updatedAt',
      },
    }
  )

  expect(parsed.attributes).toEqual({
    id: {
      type: 'number',
      autoIncrement: true,
      columnName: 'id',
    },
    name: {
      columnName: 'name',
      type: 'string',
      required: true,
    },
  })
})

test('static model parsing only treats top-level false attributes as disabled columns', async ({ expect }) => {
  const parsed = parseModelFile(
    `module.exports = {
      attributes: {
        profile: {
          type: 'json',
          defaultsTo: {
            public: false,
          },
        },
        updatedAt: false,
      },
    }`,
    'Profile.js',
    {
      id: {
        type: 'number',
        autoIncrement: true,
        columnName: 'id',
      },
      updatedAt: {
        type: 'number',
        autoUpdatedAt: true,
        columnName: 'updatedAt',
      },
    }
  )

  expect(parsed.attributes.profile).toEqual({
    columnName: 'profile',
    type: 'json',
  })
  expect(parsed.attributes.updatedAt).toBe(undefined)
})
