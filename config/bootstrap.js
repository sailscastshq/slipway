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

  // Ensure Docker network exists
  try {
    await sails.helpers.docker.ensureNetwork()
  } catch (error) {
    sails.log.warn('Could not ensure Docker network. Docker may not be available.')
    sails.log.verbose(error)
  }

  // Configure Caddy TLS if ACME email is set
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
  }
}
