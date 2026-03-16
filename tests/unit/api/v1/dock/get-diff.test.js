const test = require('node:test')
const assert = require('node:assert/strict')

const getDiff = require('../../../../../api/controllers/api/v1/dock/get-diff')

const originalGlobals = {
  User: global.User,
  Project: global.Project,
  Environment: global.Environment,
  App: global.App,
  sails: global.sails
}

function withPopulate(record) {
  return {
    async populate() {
      return record
    }
  }
}

function createContext() {
  const response = {
    statusCode: 200,
    status(code) {
      this.statusCode = code
      return this
    }
  }

  return {
    req: {
      session: { userId: 1 },
      query: {}
    },
    res: response
  }
}

test.afterEach(() => {
  global.User = originalGlobals.User
  global.Project = originalGlobals.Project
  global.Environment = originalGlobals.Environment
  global.App = originalGlobals.App
  global.sails = originalGlobals.sails
})

test('get-diff returns a stable error payload when static model source is missing', async () => {
  global.User = {
    findOne: async () => ({ id: 1, team: 10 })
  }

  global.Project = {
    findOne: () => withPopulate({
      id: 20,
      slug: 'demo',
      team: { id: 10 }
    })
  }

  global.Environment = {
    findOne: async () => ({ id: 30, slug: 'production' })
  }

  global.App = {
    findOne: async () => null
  }

  global.sails = {
    log: {
      warn() {},
      error() {}
    },
    helpers: {
      dock: {
        getDatabaseService: async () => ({
          service: {
            id: 40,
            type: 'postgresql'
          }
        }),
        getModelsStatic: async () => {
          const error = new Error('Source directory not found')
          error.code = 'notFound'
          error.exit = 'notFound'
          throw error
        }
      }
    }
  }

  const context = createContext()
  const result = await getDiff.fn.call(context, {
    projectSlug: 'demo',
    environmentSlug: 'production'
  })

  assert.equal(context.res.statusCode, 400)
  assert.equal(result.code, 'modelsSourceNotFound')
  assert.equal(
    result.error,
    'Could not read models because the source directory was not found. Push source code first.'
  )
  assert.equal(result.modelsSource, 'static')
  assert.equal(result.hasPendingChanges, false)
  assert.deepEqual(result.statements, [])
  assert.deepEqual(result.diff, {
    tablesToCreate: [],
    tablesToDrop: [],
    columnsToAdd: [],
    columnsToModify: [],
    columnsToDrop: [],
    indexesToCreate: []
  })
})
