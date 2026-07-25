module.exports = {
  hookTimeout: 80000,

  custom: {
    baseUrl: process.env.SLIPWAY_URL,
    slipwayDomain: null,
    slipwayPortRange: {
      start: Number(process.env.SLIPWAY_APP_PORT_START) || 1338,
      end: Number(process.env.SLIPWAY_APP_PORT_END) || 1500
    }
  },

  models: {
    migrate: process.env.SLIPWAY_MIGRATE || 'safe',
    dataEncryptionKeys: {
      default: process.env.DATA_ENCRYPTION_KEY
    }
  },

  blueprints: {
    shortcuts: false
  },

  session: {
    secret: process.env.SESSION_SECRET,
    cookie: {
      secure: process.env.SLIPWAY_SSL === 'true',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000
    }
  },

  sockets: {
    onlyAllowOrigins: [process.env.SLIPWAY_URL]
  },

  log: {
    level: 'info'
  },

  http: {
    trustProxy: true,
    cache: 365.25 * 24 * 60 * 60 * 1000
  }
}
