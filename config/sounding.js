const { createTagGenerators } = require('sails-hook-shipwright/lib/tags')

const e2eAssetsReady = process.env.SLIPWAY_E2E_ASSETS_READY === '1'

module.exports.sounding = {
  app: {
    liftOptions: e2eAssetsReady
      ? {
          hooks: {
            shipwright: false,
            dev: false,
            sse: true
          },
          views: {
            locals: {
              shipwright: createTagGenerators(process.cwd())
            }
          }
        }
      : {
          hooks: {
            dev: false
          }
        }
  },
  auth: {
    password: {
      form: {
        returnUrl: 'redirect'
      }
    }
  }
}
