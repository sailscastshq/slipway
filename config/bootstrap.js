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
  // Check if Slipway has been set up (genesis user exists)
  const genesisUser = await User.findOne({ isGenesisUser: true })

  // Store setup status in config for middleware/policies to use
  sails.config.custom.slipwayIsSetup = !!genesisUser

  if (genesisUser) {
    sails.log.info('Slipway is configured. Genesis user:', genesisUser.email)
  } else {
    sails.log.info('Slipway needs initial setup. Visit /setup or /register to configure.')
  }

  // Ensure Docker network exists (will be implemented in helper)
  // await sails.helpers.docker.ensureNetwork()
}
