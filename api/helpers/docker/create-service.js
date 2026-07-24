module.exports = {
  friendlyName: 'Create service',

  description:
    'Create a backing service container from its pinned image reference.',

  inputs: {
    serviceId: {
      type: 'string',
      required: true,
      description: 'Service record ID'
    }
  },

  exits: {
    success: {
      description: 'Service container is running',
      outputType: 'ref'
    }
  },

  fn: async function ({ serviceId }) {
    const service = await Service.findOne({ id: serviceId }).decrypt()
    if (!service) throw new Error('Service not found')

    let imageReference = service.imageReference
    let imageMetadata = service.imageMetadata || {}
    const volumeName =
      imageMetadata.volumeName ||
      Service.getDataVolumeName(service.containerName)

    try {
      if (!imageReference) {
        const resolved = await sails.helpers.docker.resolveServiceImage.with({
          type: service.type,
          version: service.version
        })
        imageReference = resolved.imageReference
        imageMetadata = {
          source: 'provisioning',
          tag: resolved.imageTag,
          imageId: resolved.imageId,
          repoDigest: resolved.repoDigest,
          resolvedAt: resolved.resolvedAt,
          usedLocalFallback: resolved.usedLocalFallback,
          volumeName
        }

        await Service.updateOne({ id: service.id }).set({
          imageReference,
          imageMetadata
        })
      }

      sails.log.info(
        `Creating ${service.type} service: ${service.containerName}`
      )

      const started = await sails.helpers.docker.runServiceContainer.with({
        service,
        containerName: service.containerName,
        imageReference,
        volumeName
      })

      await Service.updateOne({ id: serviceId }).set({
        containerId: started.containerId,
        imageReference,
        imageMetadata: { ...imageMetadata, volumeName },
        status: 'running'
      })

      sails.log.info(
        `Service started: ${
          service.containerName
        } (${started.containerId.substring(0, 12)})`
      )

      return {
        ...started,
        type: service.type
      }
    } catch (error) {
      sails.log.error(`Failed to create service: ${error.message || error}`)
      await Service.updateOne({ id: serviceId }).set({ status: 'failed' })
      throw error
    }
  }
}
