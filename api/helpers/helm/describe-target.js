const crypto = require('node:crypto')

module.exports = {
  friendlyName: 'Describe Helm target',

  description:
    'Build the stable, non-secret project, environment, app, container, and deployment context for a Helm execution.',

  inputs: {
    scope: {
      type: 'ref',
      required: true
    }
  },

  sync: true,

  fn: function ({ scope }) {
    const deployment =
      scope.app.currentDeployment &&
      typeof scope.app.currentDeployment === 'object'
        ? scope.app.currentDeployment
        : null
    const version =
      deployment?.gitCommit ||
      deployment?.imageName ||
      deployment?.imageId ||
      scope.app.imageName ||
      scope.app.imageId ||
      null
    const target = {
      project: {
        id: scope.project.id,
        name: scope.project.name,
        slug: scope.project.slug
      },
      environment: {
        id: scope.environment.id,
        name: scope.environment.name,
        slug: scope.environment.slug,
        isProduction: Boolean(scope.environment.isProduction)
      },
      app: {
        id: scope.app.id,
        name: scope.app.name,
        slug: scope.app.slug
      },
      container: scope.app.containerName || null,
      deployment: deployment
        ? {
            id: deployment.id,
            gitCommit: deployment.gitCommit || null,
            gitBranch: deployment.gitBranch || null,
            imageId: deployment.imageId || null,
            imageName: deployment.imageName || null
          }
        : null,
      version,
      displayVersion: shortVersion(version)
    }

    target.fingerprint = crypto
      .createHash('sha256')
      .update(
        JSON.stringify([
          target.project.id,
          target.environment.id,
          target.app.id,
          target.container,
          target.deployment?.id || null,
          target.version
        ])
      )
      .digest('hex')

    return target
  }
}

function shortVersion(version) {
  if (!version) return null
  const value = String(version)
  const sha = value.match(/(?:sha256:)?([0-9a-f]{7,64})/i)
  if (sha) return sha[1].slice(0, 7)
  const tag = value.split(':').at(-1)
  return tag.length > 18 ? `${tag.slice(0, 15)}…` : tag
}
