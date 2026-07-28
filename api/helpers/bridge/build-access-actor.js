module.exports = {
  friendlyName: 'Build Bridge access actor',

  description:
    'Build the serializable actor passed to host-app authorization for an invited Bridge user.',

  inputs: {
    access: { type: 'ref', required: true },
    project: { type: 'ref', required: true },
    environment: { type: 'ref', required: true },
    app: { type: 'ref', required: true }
  },

  exits: {
    success: { outputType: 'ref' }
  },

  fn: async function ({ access, project, environment, app }) {
    return {
      id: String(access.hostUserId),
      email: access.email,
      fullName: access.hostUserName,
      role: access.role,
      bridgeRole: access.role,
      source: 'host-app',
      appId: String(app.id),
      appSlug: app.slug,
      teamId: String(access.team),
      projectId: String(project.id),
      projectSlug: project.slug,
      environmentId: String(environment.id),
      environmentSlug: environment.slug
    }
  }
}
