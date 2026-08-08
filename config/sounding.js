const soundingPort =
  Number(process.env.SOUNDING_PORT) || 30000 + (process.pid % 20000)

module.exports.sounding = {
  app: {
    liftOptions: {
      explicitHost: '127.0.0.1',
      port: soundingPort,
      custom: {
        baseUrl: `http://127.0.0.1:${soundingPort}`
      },
      hooks: {
        sockets: true
      }
    }
  },
  browser: {
    projects: [
      {
        name: 'desktop'
      },
      {
        name: 'mobile',
        device: 'iPhone 13'
      }
    ],
    defaultProject: 'desktop'
  }
}
