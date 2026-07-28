module.exports = {
  friendlyName: 'Get Bridge app URL',

  description:
    'Resolve the public app URL, including a non-root application route prefix.',

  inputs: {
    app: {
      type: 'ref',
      required: true
    },
    environment: {
      type: 'ref',
      required: true
    },
    project: {
      type: 'ref',
      required: true
    }
  },

  exits: {
    success: {
      outputType: 'string'
    }
  },

  fn: async function ({ app, environment, project }) {
    if (app.routePath === null) return ''

    const serverIp = await sails.helpers.getServerIp()
    const directUrl =
      app.hostPort && serverIp ? `http://${serverIp}:${app.hostPort}` : null
    const { primaryUrl } = await Environment.resolveAppUrls(
      { ...environment, project },
      { directUrl }
    )
    if (!primaryUrl) return ''

    const routePath =
      app.routePath && app.routePath !== '/'
        ? `/${String(app.routePath).replace(/^\/+|\/+$/g, '')}`
        : ''
    return `${primaryUrl.replace(/\/$/, '')}${routePath}`
  }
}
