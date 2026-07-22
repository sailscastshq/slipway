/**
 * Seed Function
 * (sails.config.bootstrap)
 *
 * A function that runs just before your Sails app gets lifted.
 * > Need more flexibility?  You can also create a hook.
 *
 * For more information on seeding your app with fake data, check out:
 * https://sailsjs.com/config/bootstrap
 */

module.exports.bootstrap = async function () {
  // Production uses `migrate: safe`; create coordinator tables before any
  // deployment job queries run on an existing installation.
  await sails.helpers.deploy.ensureQueueSchema()

  // Initialize CLI tokens map for Bearer token authentication
  sails.cliTokens = new Map()

  // Check if Slipway has been set up (genesis user exists)
  const genesisUser = await User.findOne({ isGenesisUser: true })

  // Store setup status in config for middleware/policies to use
  sails.config.custom.slipwayIsSetup = !!genesisUser

  if (genesisUser) {
    sails.log.info('Slipway is configured. Genesis user:', genesisUser.email)
  } else {
    sails.log.info('Slipway needs initial setup. Visit /setup to configure.')
  }

  const skipInfraBootstrap = sails.config.environment === 'test'
  const isQuestWorker = sails.config.environment === 'console'

  // One-time migration: backfill multi-app fields on existing App/Deployment records
  const migrationDone = await sails.helpers.setting.get('multiAppMigrationDone')
  if (!migrationDone) {
    try {
      const apps = await App.find()
      for (const app of apps) {
        const updates = {}
        if (!app.slug) updates.slug = 'app'
        if (!app.name) updates.name = 'app'
        if (app.isDefault === undefined || app.isDefault === null)
          updates.isDefault = true
        if (Object.keys(updates).length > 0) {
          await App.updateOne({ id: app.id }).set(updates)
        }
      }

      // Backfill Deployment.app for existing deployments
      const deployments = await Deployment.find({ app: null })
      for (const dep of deployments) {
        const app = await App.findOne({ environment: dep.environment })
        if (app) {
          await Deployment.updateOne({ id: dep.id }).set({ app: app.id })
        }
      }

      await sails.helpers.setting.set('multiAppMigrationDone', 'true')
      sails.log.info('Multi-app migration completed successfully.')
    } catch (err) {
      sails.log.warn(
        'Multi-app migration failed (will retry on next boot):',
        err.message
      )
    }
  }

  if (skipInfraBootstrap) {
    return
  }

  // Ensure Docker network exists
  try {
    await sails.helpers.docker.ensureNetwork()
  } catch (error) {
    sails.log.warn(
      'Could not ensure Docker network. Docker may not be available.'
    )
    sails.log.verbose(error)
  }

  // Configure Caddy TLS and dashboard route if set up
  if (genesisUser) {
    try {
      const acmeEmail = await sails.helpers.setting.get('acmeEmail')
      if (acmeEmail) {
        await sails.helpers.caddy.configureTls({ acmeEmail })
        sails.log.info('Caddy TLS configured with ACME email:', acmeEmail)
      }
    } catch (error) {
      sails.log.verbose('Could not configure Caddy TLS:', error.message)
    }

    try {
      const instanceDomain = await sails.helpers.setting.get('instanceDomain')
      if (instanceDomain) {
        await sails.helpers.caddy.updateDashboardRoute(instanceDomain)
        sails.log.info('Caddy dashboard route configured for:', instanceDomain)
      }
    } catch (error) {
      sails.log.verbose(
        'Could not configure Caddy dashboard route:',
        error.message
      )
    }
  }

  // Quest child processes run the same bootstrap. Only the long-lived web
  // process performs startup recovery; the watchdog script handles console.
  if (!isQuestWorker) {
    try {
      await sails.helpers.deploy.reconcileDeployments()
      process.nextTick(() => {
        sails.helpers.deploy.runQueuedDeployments().catch((error) => {
          sails.log.error(
            `Could not dispatch queued deployments: ${error.message || error}`
          )
        })
      })
    } catch (error) {
      sails.log.warn(
        `Could not reconcile deployment pipelines: ${error.message || error}`
      )
    }
  }
}
