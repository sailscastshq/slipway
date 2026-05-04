const { test } = require('sounding')

test('dock diff returns a stable error payload when static model source is missing', async ({
  expect,
  request,
  sails
}) => {
  const current = await sails.sounding.world.use('configured-slipway')
  const originalGetDatabaseService = sails.helpers.dock.getDatabaseService
  const originalGetModelsStatic = sails.helpers.dock.getModelsStatic

  const project = await sails.models.project
    .create({
      name: 'Demo',
      slug: 'demo',
      team: current.teams.genesisTeam.id,
      createdBy: current.users.genesisUser.id
    })
    .fetch()
  await sails.models.environment
    .create({
      name: 'Production',
      slug: 'production',
      project: project.id,
      isProduction: true
    })
    .fetch()

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
      .as(current.users.genesisUser)
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
})
