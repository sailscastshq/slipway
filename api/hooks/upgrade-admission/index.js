module.exports = function upgradeAdmission(sails) {
  return {
    configure() {
      const ready = require('../../lib/upgrade-startup').fromEnvironment(
        sails.config.datastores
      )
      if (!ready) return
      if (sails.config.models.migrate !== 'safe') {
        const error = new Error(
          'Coordinated startup requires safe ORM configuration.'
        )
        error.code = 'upgradeNotReady'
        throw error
      }
      sails.upgradeAdmission = ready
    }
  }
}
