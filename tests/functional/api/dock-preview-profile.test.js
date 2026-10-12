const { test } = require('sounding')
const assert = require('node:assert/strict')
test(
  'Dock preview overlaps independent reads, labels model identity and preserves physical SQL',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'preview-performance' } }
    }
  },
  async ({ sails, world, request, expect }) => {
    const current = world.current
    await sails.models.app
      .updateOne(current.apps.web.id)
      .set({ status: 'running', containerName: 'synthetic-runtime' })
    const originals = {
      service: sails.helpers.dock.getDatabaseService,
      models: sails.helpers.dock.getModels,
      schema: sails.helpers.dock.getSchema,
      preflight: sails.helpers.dock.preflightNativeMigration,
      user: User.forRequest
    }
    const requests = []
    let catalogStarted = false
    const schema = {
      invoices: {
        catalogComplete: true,
        columns: [
          {
            name: 'id',
            type: 'integer',
            primaryKey: true,
            autoIncrement: true,
            nullable: false
          },
          {
            name: 'paid_at',
            type: 'real',
            primaryKey: false,
            autoIncrement: false,
            nullable: true
          }
        ],
        indexes: []
      }
    }
    try {
      User.forRequest = async () => ({
        ...current.users.genesisUser,
        team: current.teams.genesisTeam.id,
        teamRole: 'member'
      })
      sails.helpers.dock.getDatabaseService = async () => ({
        service: { id: 40, type: 'postgresql' }
      })
      sails.helpers.dock.getSchema = async () => {
        catalogStarted = true
        await new Promise((r) => setTimeout(r, 25))
        return { tables: schema }
      }
      sails.helpers.dock.getModels = async (
        containerName,
        preview,
        forceRefresh
      ) => {
        assert.equal(
          catalogStarted,
          true,
          'Catalog must start before waiting for app boot'
        )
        requests.push({ containerName, preview, forceRefresh })
        return {
          models: {
            invoice: {
              identity: 'invoice',
              tableName: 'invoices',
              primaryKey: 'id',
              attributes: {
                id: { type: 'number', autoIncrement: true },
                paidAt: {
                  type: 'number',
                  columnName: 'paid_at',
                  columnType: 'double precision'
                }
              }
            }
          }
        }
      }
      sails.helpers.dock.preflightNativeMigration = async (
        _service,
        statements
      ) => ({
        verified: true,
        statements,
        affectedRows: { invoices: 0 },
        engineImage: 'synthetic'
      })
      for (const refreshModels of [false, true]) {
        catalogStarted = false
        const response = await request
          .as('genesisUser')
          .get(
            '/api/v1/projects/preview-performance/dock/diff' +
              (refreshModels ? '?refreshModels=true' : '')
          )
        expect(response).toHaveStatus(200)
        expect(response).toHaveJsonPath('modelLabels.invoices', 'invoice')
        expect(response).toHaveJsonPath(
          'diff.columnsToModify.0.tableName',
          'invoices'
        )
        expect(response).toHaveJsonPath('statements.0.table', 'invoices')
        assert.equal(requests.at(-1).preview, true)
        assert.equal(requests.at(-1).forceRefresh, refreshModels)
      }
    } finally {
      sails.helpers.dock.getDatabaseService = originals.service
      sails.helpers.dock.getModels = originals.models
      sails.helpers.dock.getSchema = originals.schema
      sails.helpers.dock.preflightNativeMigration = originals.preflight
      User.forRequest = originals.user
    }
  }
)
