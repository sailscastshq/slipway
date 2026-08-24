module.exports.sounding = {
  app: {
    liftOptions: {
      explicitHost: '127.0.0.1',
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
