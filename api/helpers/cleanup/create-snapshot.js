const path = require('node:path')

module.exports = {
  friendlyName: 'Create cleanup snapshot',

  description:
    'Capture the records and external artifacts needed for resumable cleanup.',

  inputs: {
    scopeType: {
      type: 'string',
      required: true,
      isIn: ['project', 'environment', 'app', 'service']
    },
    resourceId: {
      type: 'number',
      required: true
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    },
    notFound: {}
  },

  fn: async function ({ scopeType, resourceId }) {
    const target = await resolveTarget(scopeType, resourceId)
    if (!target) throw 'notFound'

    const { project, environment, app, service } = target
    const environments =
      scopeType === 'project'
        ? await Environment.find({ project: project.id })
        : [environment]
    const environmentIds = uniqueIds(environments)

    const apps =
      scopeType === 'app'
        ? [app]
        : scopeType === 'service'
        ? []
        : await findByIds(App, 'environment', environmentIds)
    const services =
      scopeType === 'service'
        ? [service]
        : scopeType === 'app'
        ? []
        : await findByIds(Service, 'environment', environmentIds)
    const appIds = uniqueIds(apps)
    const serviceIds = uniqueIds(services)

    const deployments =
      scopeType === 'service'
        ? []
        : scopeType === 'app'
        ? await Deployment.find({ app: app.id })
        : await findByIds(Deployment, 'environment', environmentIds)
    const deploymentIds = uniqueIds(deployments)
    const deploymentJobs = await findByIds(
      DeploymentJob,
      'deployment',
      deploymentIds
    )
    const deploymentLeases = await findByIds(
      DeploymentLease,
      'deployment',
      deploymentIds
    )
    const backups = await findByIds(Backup, 'service', serviceIds)

    const repositories = (await GitRepository.find()).filter(
      (repository) =>
        appIds.includes(normalizeId(repository.app)) ||
        environmentIds.includes(normalizeId(repository.environment))
    )
    const deployTokens =
      scopeType === 'project' || scopeType === 'environment'
        ? (await DeployToken.find()).filter(
            (token) =>
              (scopeType === 'project' &&
                normalizeId(token.project) === project.id) ||
              environmentIds.includes(normalizeId(token.environment))
          )
        : []
    const reservations = (await PortReservation.find()).filter(
      (reservation) =>
        deploymentIds.map(String).includes(String(reservation.ownerId)) ||
        apps.some(
          (candidate) =>
            candidate.hostPort != null &&
            Number(candidate.hostPort) === Number(reservation.port)
        )
    )

    const routes =
      scopeType === 'service'
        ? []
        : scopeType === 'app'
        ? [
            {
              action: 'update',
              projectSlug: project.slug,
              environmentSlug: environment.slug,
              environmentId: environment.id,
              excludedAppIds: appIds
            }
          ]
        : environments.map((candidate) => ({
            action: 'remove',
            projectSlug: project.slug,
            environmentSlug: candidate.slug,
            environmentId: candidate.id
          }))

    const containerNames = uniqueStrings([
      ...apps.map((candidate) => candidate.containerName),
      ...services.flatMap(serviceContainerNames),
      ...deploymentJobs.flatMap((job) => [
        job.candidateContainerName,
        job.previousContainerName
      ])
    ])
    const volumeNames = uniqueStrings(services.flatMap(serviceVolumeNames))
    const imageNames = uniqueStrings([
      ...apps.map((candidate) => candidate.imageName),
      ...deployments.map((candidate) => candidate.imageName),
      ...deploymentJobs.map((candidate) => candidate.imageName)
    ])
    const backupObjects = backups
      .filter((candidate) => candidate.s3Key)
      .map((candidate) => ({
        backupId: candidate.id,
        s3Key: candidate.s3Key
      }))
    const sourcePaths =
      scopeType === 'project'
        ? [path.join(sails.config.custom.slipwayAppsDir, String(project.slug))]
        : []
    const buildContexts = deploymentJobs
      .filter((job) => job.buildContextPath)
      .map((job) => ({
        deploymentId: normalizeId(job.deployment),
        contextPath: job.buildContextPath
      }))

    return {
      version: 1,
      target: {
        scopeType,
        resourceId,
        projectId: project.id,
        environmentId: environment?.id || null,
        appId: app?.id || null,
        serviceId: service?.id || null,
        teamId: normalizeId(project.team),
        label:
          project.name && scopeType === 'project'
            ? project.name
            : app?.name || service?.name || environment?.name || project.name,
        projectSlug: project.slug,
        environmentSlug: environment?.slug || null,
        appSlug: app?.slug || null
      },
      records: {
        projectIds: scopeType === 'project' ? [project.id] : [],
        environmentIds,
        appIds,
        serviceIds,
        deploymentIds,
        deploymentJobIds: uniqueIds(deploymentJobs),
        deploymentLeaseIds: uniqueIds(deploymentLeases),
        backupIds: uniqueIds(backups),
        repositoryIds: uniqueIds(repositories),
        deployTokenIds: uniqueIds(deployTokens)
      },
      services: services.map((candidate) => ({
        id: candidate.id,
        environmentId: normalizeId(candidate.environment),
        envVarKey: candidate.envVarKey || null
      })),
      artifacts: {
        routes,
        containerNames,
        volumeNames,
        imageNames,
        backupObjects,
        sourcePaths,
        buildContexts,
        portReservationIds: uniqueIds(reservations),
        hostPorts: uniqueNumbers(apps.map((candidate) => candidate.hostPort))
      }
    }
  }
}

async function resolveTarget(scopeType, resourceId) {
  if (scopeType === 'project') {
    const project = await Project.findOne({ id: resourceId })
    return project ? { project } : null
  }

  if (scopeType === 'environment') {
    const environment = await Environment.findOne({ id: resourceId })
    if (!environment) return null
    const project = await Project.findOne({
      id: normalizeId(environment.project)
    })
    return project ? { project, environment } : null
  }

  if (scopeType === 'app') {
    const app = await App.findOne({ id: resourceId })
    if (!app) return null
    const environment = await Environment.findOne({
      id: normalizeId(app.environment)
    })
    if (!environment) return null
    const project = await Project.findOne({
      id: normalizeId(environment.project)
    })
    return project ? { project, environment, app } : null
  }

  const service = await Service.findOne({ id: resourceId })
  if (!service) return null
  const environment = await Environment.findOne({
    id: normalizeId(service.environment)
  })
  if (!environment) return null
  const project = await Project.findOne({
    id: normalizeId(environment.project)
  })
  return project ? { project, environment, service } : null
}

async function findByIds(model, attribute, ids) {
  if (ids.length === 0) return []
  return model.find({ [attribute]: { in: ids } })
}

function serviceContainerNames(service) {
  return [
    service.containerName,
    service.imageMetadata?.previous?.containerName,
    service.upgradeState?.candidateContainerName,
    service.upgradeState?.rollbackContainerName,
    service.upgradeState?.recovery?.previousContainerName
  ]
}

function serviceVolumeNames(service) {
  return [
    service.imageMetadata?.volumeName,
    service.imageMetadata?.previous?.volumeName,
    service.upgradeState?.candidateVolumeName,
    service.upgradeState?.previousVolumeName,
    service.upgradeState?.recovery?.previousVolumeName,
    service.containerName
      ? Service.getDataVolumeName(service.containerName)
      : null
  ]
}

function uniqueIds(records) {
  return [
    ...new Set(
      records
        .map((record) => normalizeId(record))
        .filter((value) => value !== null && value !== undefined)
    )
  ]
}

function uniqueStrings(values) {
  return [
    ...new Set(
      values
        .filter((value) => value !== null && value !== undefined)
        .map(String)
        .filter(Boolean)
    )
  ]
}

function uniqueNumbers(values) {
  return [
    ...new Set(
      values
        .filter((value) => value !== null && value !== undefined)
        .map(Number)
        .filter(Number.isFinite)
    )
  ]
}

function normalizeId(value) {
  return value && typeof value === 'object' ? value.id : value
}
