module.exports = {
  friendlyName: 'View service settings',

  description: 'Display settings page for a service.',

  inputs: {
    slug: {
      type: 'string',
      required: true,
      description: 'Project slug'
    },
    envSlug: {
      type: 'string',
      required: true,
      description: 'Environment slug'
    },
    serviceId: {
      type: 'string',
      required: true,
      description: 'Service ID'
    }
  },

  exits: {
    success: {
      responseType: 'inertia'
    },
    notFound: {
      responseType: 'redirect'
    }
  },

  fn: async function ({ slug, envSlug, serviceId }) {
    const {
      getPolicy,
      getUpgradePlan,
      inspectVersion
    } = require('../../lib/service-image-policy')
    const user = await User.findOne({ id: this.req.session.userId }).populate(
      'team'
    )

    const project = await Project.findOne({ slug, team: user.team.id })
    if (!project) throw { notFound: '/' }

    const environment = await Environment.findOne({
      slug: envSlug,
      project: project.id
    })
    if (!environment) throw { notFound: `/projects/${slug}` }

    const service = await Service.findOne({
      id: serviceId,
      environment: environment.id
    })
    if (!service)
      throw { notFound: `/projects/${slug}/environments/${envSlug}` }

    const policy = getPolicy(service.type)
    let versionSupport = 'unresolved'
    try {
      versionSupport = inspectVersion(service.type, service.version, {
        useDefault: false
      }).supported
        ? 'supported'
        : 'custom'
    } catch {
      /* Legacy mutable records stay visibly unresolved. */
    }

    const availableUpgrades = (policy?.versions || [])
      .map((entry) => {
        try {
          return getUpgradePlan(service.type, service.version, entry.version)
        } catch {
          return null
        }
      })
      .filter(Boolean)

    let backupConfigured = false
    try {
      await sails.helpers.backup.getStorageConfig()
      backupConfigured = true
    } catch {
      /* The page shows the storage prerequisite. */
    }

    return {
      page: 'projects/service-settings',
      props: {
        project: {
          id: project.id,
          name: project.name,
          slug: project.slug
        },
        environment: {
          id: environment.id,
          name: environment.name,
          slug: environment.slug
        },
        service: {
          id: service.id,
          name: service.name,
          type: service.type,
          version: service.version,
          versionSupport,
          imageReference: service.imageReference,
          imageMetadata: service.imageMetadata,
          upgradeState: service.upgradeState,
          status: service.status,
          resourceLimits: service.resourceLimits
        },
        versionPolicy: policy
          ? {
              label: policy.label,
              defaultVersion: policy.defaultVersion,
              versions: policy.versions.map((entry) => ({ ...entry }))
            }
          : null,
        availableUpgrades,
        backupConfigured
      }
    }
  }
}
