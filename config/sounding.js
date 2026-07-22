module.exports.sounding = {
  app: {
    liftOptions: {
      explicitHost: '127.0.0.1',
      port: Number(process.env.SOUNDING_PORT) || 30000 + (process.pid % 20000)
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
