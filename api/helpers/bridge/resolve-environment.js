module.exports = {
  friendlyName: 'Resolve environment',

  description: 'Resolve user → project → environment → app from request params. Shared auth/lookup for Bridge actions.',

  inputs: {
    req: {
      type: 'ref',
      required: true,
      description: 'The request object'
    },
    projectSlug: {
      type: 'string',
      required: true
    },
    environmentSlug: {
      type: 'string',
      defaultsTo: 'production'
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    },
    notFound: {
      description: 'Project or environment not found'
    },
    forbidden: {
      description: 'User does not have access'
    },
    appNotRunning: {
      description: 'App is not running'
    }
  },

  fn: async function ({ req, projectSlug, environmentSlug }) {
    return await sails.helpers.resolveApp.with({
      req,
      projectSlug,
      environmentSlug,
      requireRunning: true
    })
  }
}
