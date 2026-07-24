module.exports = {
  friendlyName: 'Migrate legacy service versions',

  description:
    'Backfill mutable or unresolved service image records from their existing Docker containers without recreating them.',

  inputs: {},

  fn: async function () {
    const services = await Service.find()
    const candidates = services.filter(
      (service) =>
        service.version === 'latest' ||
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

        if (service.version === 'latest' && !inspected.version) {
          result.unresolved += 1
          sails.log.warn(
            `Could not determine the pinned version for legacy service ${service.name}; leaving it unresolved.`
          )
          continue
        }

        await Service.updateOne({ id: service.id }).set({
          version:
            service.version === 'latest' ? inspected.version : service.version,
          imageReference: inspected.imageReference,
          imageMetadata: {
            source: 'running-container',
            migratedAt: Date.now(),
            configuredImage: inspected.configuredImage,
            detectedVersion: inspected.detectedVersion,
            imageId: inspected.imageId,
            repoDigest: inspected.repoDigest
          }
        })
        result.migrated += 1
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
