const { test } = require('sounding')

test(
  'dock diff returns a stable error payload when static model source is missing',
  {
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: { slug: 'demo', name: 'Demo' }
      }
    }
  },
  async ({ expect, request, sails }) => {
    const originalGetDatabaseService = sails.helpers.dock.getDatabaseService
    const originalGetModelsStatic = sails.helpers.dock.getModelsStatic

    sails.helpers.dock.getDatabaseService = async () => ({
      service: {
        id: 40,
        type: 'postgresql'
      }
    })
    sails.helpers.dock.getModelsStatic = async () => {
      const error = new Error('Source directory not found')
      error.code = 'notFound'
      error.exit = 'notFound'
      throw error
    }

    try {
      const response = await request
        .as('genesisUser')
        .get('/api/v1/projects/demo/dock/diff')

      expect(response).toHaveStatus(400)
      expect(response).toHaveJsonPath('code', 'modelsSourceNotFound')
      expect(response).toHaveJsonPath(
        'error',
        'Could not read models because the source directory was not found. Push source code first.'
      )
      expect(response).toHaveJsonPath('modelsSource', 'static')
      expect(response).toHaveJsonPath('hasPendingChanges', false)
      expect(response).toHaveJsonPath('statements', [])
      expect(response).toHaveJsonPath('diff', {
        tablesToCreate: [],
        tablesToDrop: [],
        columnsToRename: [],
        columnsToAdd: [],
        columnsToModify: [],
        columnsToDrop: [],
        indexesToCreate: []
      })
    } finally {
      sails.helpers.dock.getDatabaseService = originalGetDatabaseService
      sails.helpers.dock.getModelsStatic = originalGetModelsStatic
    }
  }
)
