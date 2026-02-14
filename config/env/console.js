const PRODUCTION_CONFIG = require('./production')

module.exports = Object.assign({}, PRODUCTION_CONFIG, {
  hooks: {
    shipwright: false,
    flash: false,
    content: false,
    views: false,
    sockets: false,
    pubsub: false,
    dev: false,
    sesssion: false
  }
})
