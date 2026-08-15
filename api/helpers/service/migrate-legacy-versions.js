const LEGACY_VERSION_RESOLUTION_SCHEMA = 1

module.exports = {
  friendlyName: 'Migrate legacy service versions',

  description:
    'Backfill mutable or unresolved service image records from their existing Docker containers without recreating them.',

  inputs: {},

  fn: async function () {
    const services = await Service.find()
    const candidates = services.filter(
      (service) =>
        (service.version === 'latest' &&
          service.imageMetadata?.versionResolution?.schemaVersion !==
            LEGACY_VERSION_RESOLUTION_SCHEMA) ||
        !service.imageReference ||
        !service.imageMetadata
    )
    const result = { migrated: 0, unresolved: 0 }

    for (const service of candidates) {
      if (!service.containerName) {
        result.unresolved += 1
        continue
      }

      try {
        const inspected =
          await sails.helpers.docker.inspectRunningServiceImage.with({
            type: service.type,
            containerName: service.containerName
          })

        const resolvedVersion =
          service.version === 'latest' ? inspected.version : service.version
        const versionResolved = Boolean(
          resolvedVersion && resolvedVersion !== 'latest'
        )

        await Service.updateOne({ id: service.id }).set({
          version: resolvedVersion || service.version,
          imageReference: inspected.imageReference,
          imageMetadata: {
            ...(service.imageMetadata || {}),
            source: 'running-container',
            migratedAt: Date.now(),
            configuredImage: inspected.configuredImage,
            detectedVersion: inspected.detectedVersion,
            versionDetectionSource: inspected.versionDetectionSource,
            imageId: inspected.imageId,
            repoDigest: inspected.repoDigest,
            versionResolution: {
              schemaVersion: LEGACY_VERSION_RESOLUTION_SCHEMA,
              status: versionResolved ? 'resolved' : 'unresolved',
              source:
                service.version === 'latest'
                  ? inspected.versionDetectionSource
                  : 'stored-version'
            }
          }
        })
        result.migrated += 1

        if (!versionResolved) {
          result.unresolved += 1
          sails.log.warn(
            `Pinned the immutable image for legacy service ${service.name}, but could not determine its version.`
          )
        }
      } catch (error) {
        result.unresolved += 1
        sails.log.warn(
          `Could not pin legacy service ${service.name}: ${error.message}`
        )
      }
    }

    if (result.migrated > 0) {
      sails.log.info(
        `Pinned ${result.migrated} existing service image${
          result.migrated === 1 ? '' : 's'
        } without recreating containers.`
      )
    }

    return result
  }
}
