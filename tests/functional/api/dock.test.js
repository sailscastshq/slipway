const { test } = require('sounding')
const { withCsrfFromPage } = require('../../support/csrf-request')

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

test(
  'dock SQL returns labeled results for every statement',
  {
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: { slug: 'multi-results', name: 'Multi Results' }
      }
    }
  },
  async ({ expect, request, sails }) => {
    const originalGetDatabaseService = sails.helpers.dock.getDatabaseService
    const originalExecuteSql = sails.helpers.dock.executeSql
    const results = [
      {
        statementIndex: 0,
        statementSql: 'SELECT count(*) AS creators FROM creators;',
        statementPreview: 'SELECT count(*) AS creators FROM creators',
        commandTag: 'SELECT',
        status: 'success',
        duration: 2.5,
        rowCount: 1,
        affected: null,
        columns: ['creators'],
        rows: [{ creators: '42' }],
        message: null,
        error: null,
        raw: 'creators\n42'
      },
      {
        statementIndex: 1,
        statementSql: 'DROP TABLE temporary_items;',
        statementPreview: 'DROP TABLE temporary_items',
        commandTag: 'DROP TABLE',
        status: 'success',
        duration: 1.25,
        rowCount: 0,
        affected: 0,
        columns: [],
        rows: [],
        message: 'DROP TABLE completed',
        error: null,
        raw: 'DROP TABLE'
      }
    ]

    sails.helpers.dock.getDatabaseService = async () => ({
      service: {
        id: 80,
        type: 'postgresql',
        containerName: 'primary-database'
      }
    })
    sails.helpers.dock.executeSql = async () => ({
      success: true,
      ...results[0],
      duration: 4,
      results,
      messages: ''
    })

    try {
      const dashboard = await withCsrfFromPage(
        request,
        '/projects/multi-results/environments/production',
        'genesisUser'
      )
      const response = await dashboard.request.post(
        '/api/v1/projects/multi-results/dock/sql',
        {
          query: results.map((result) => result.statementSql).join('\n')
        }
      )

      expect(response).toHaveStatus(200)
      expect(response).toHaveJsonPath('success', true)
      expect(response).toHaveJsonPath('results.0.statementIndex', 0)
      expect(response).toHaveJsonPath(
        'results.0.statementPreview',
        'SELECT count(*) AS creators FROM creators'
      )
      expect(response).toHaveJsonPath('results.0.rows.0.creators', '42')
      expect(response).toHaveJsonPath('results.1.commandTag', 'DROP TABLE')
      expect(response).toHaveJsonPath(
        'results.1.message',
        'DROP TABLE completed'
      )
    } finally {
      sails.helpers.dock.getDatabaseService = originalGetDatabaseService
      sails.helpers.dock.executeSql = originalExecuteSql
    }
  }
)

test(
  'dock SQL rejects a dangerous command hidden later in a batch',
  {
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: { slug: 'guarded-dock', name: 'Guarded Dock' }
      }
    }
  },
  async ({ expect, request, sails }) => {
    const originalGetDatabaseService = sails.helpers.dock.getDatabaseService
    const originalExecuteSql = sails.helpers.dock.executeSql
    let executed = false

    sails.helpers.dock.getDatabaseService = async () => ({
      service: {
        id: 81,
        type: 'postgresql',
        containerName: 'primary-database'
      }
    })
    sails.helpers.dock.executeSql = async () => {
      executed = true
      return { success: true, results: [] }
    }

    try {
      const dashboard = await withCsrfFromPage(
        request,
        '/projects/guarded-dock/environments/production',
        'genesisUser'
      )
      const response = await dashboard.request.post(
        '/api/v1/projects/guarded-dock/dock/sql',
        {
          query: [
            'SELECT count(*) FROM creators;',
            '/* never /* execute */ this */ DROP DATABASE slipway;'
          ].join('\n')
        }
      )

      expect(response).toHaveStatus(400)
      expect(response).toHaveHeader('x-exit', 'badRequest')
      expect(executed).toBe(false)
    } finally {
      sails.helpers.dock.getDatabaseService = originalGetDatabaseService
      sails.helpers.dock.executeSql = originalExecuteSql
    }
  }
)
