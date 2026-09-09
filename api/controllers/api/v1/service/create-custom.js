const custom = require('../../../../lib/custom-service')
module.exports = {
  friendlyName: 'Create reviewed custom service',
  inputs: { reviewId: { type: 'string', required: true } },
  exits: {
    success: { statusCode: 201 },
    badRequest: { responseType: 'badRequest' },
    forbidden: { statusCode: 403 }
  },
  fn: async function ({ reviewId }) {
    const review = await CustomServiceReview.findOne({
      token: reviewId
    }).decrypt()
    if (!review || review.imageMetadata?.purpose)
      throw {
        badRequest: { message: 'This review expired. Review the image again.' }
      }
    let actor
    try {
      actor = await custom.authorize(this.req, review.environment)
      if (actor.user.id !== review.actor) throw Error()
    } catch {
      throw 'forbidden'
    }
    try {
      if (review.serviceId) {
        const service = await Service.findOne({ id: review.serviceId })
        if (!service)
          custom.fail('This reviewed service was removed. Create a new review.')
        return { service: Service.toPublic(service) }
      }
      if (review.expiresAt < Date.now())
        custom.fail('This review expired. Review the image again.')
      custom.validate(review.definition)
      let created = false
      const service =
        await require('../../../../lib/with-datastore-transaction')(
          async (db) => {
            created = false
            await custom.available(
              review.environment,
              actor.project.id,
              undefined,
              db
            )
            const current = await CustomServiceReview.findOne({
              token: reviewId
            }).usingConnection(db)
            if (!current)
              custom.fail('This review expired. Review the image again.')
            if (current.serviceId)
              return Service.findOne({ id: current.serviceId })
                .decrypt()
                .usingConnection(db)
            if (current.expiresAt < Date.now())
              custom.fail('This review expired. Review the image again.')
            if (
              await Service.findOne({
                environment: review.environment,
                name: review.definition.name
              }).usingConnection(db)
            )
              custom.fail('A service with this name already exists.')
            const suffix = reviewId.replace(/-/g, '').slice(0, 16)
            const containerName = `slipway-custom-${suffix}`
            const definition = review.definition
            const customState = {
              image: definition.image,
              health: 'unverified',
              appIds: [],
              linkPrefix: definition.name.replace(/-/g, '_').toUpperCase(),
              volumes: definition.volumes.map((p, i) => ({
                name: `${containerName}-data-${i}`,
                path: p
              }))
            }
            const service = await Service.create({
              name: definition.name,
              type: 'custom',
              version: definition.image,
              imageReference: review.imageReference,
              imageMetadata: { source: 'custom-review', reviewId },
              status: 'creating',
              containerName,
              internalHost: containerName,
              internalPort: definition.port,
              environment: review.environment,
              customDefinition: definition,
              customState,
              resourceLimits: {
                cpus: String(definition.cpus),
                memory: `${definition.memoryMiB}m`
              }
            })
              .usingConnection(db)
              .fetch()
            await custom.links(service, definition.appIds, db)
            await CustomServiceReview.updateOne({ token: reviewId })
              .set({ serviceId: service.id, definition: {} })
              .usingConnection(db)
            await AuditLog.create({
              action: 'service.custom.created',
              resourceType: 'service',
              resourceId: String(service.id),
              user: actor.user.id,
              team: actor.project.team,
              details: {
                imageReference: review.imageReference,
                envKeys: Object.keys(definition.env)
              }
            }).usingConnection(db)
            created = true
            return {
              ...service,
              customDefinition: definition,
              customState: { ...customState, appIds: definition.appIds }
            }
          }
        )
      if (created) await custom.start(service)
      return {
        service: Service.toPublic(await Service.findOne({ id: service.id }))
      }
    } catch (e) {
      throw {
        badRequest: {
          message:
            e.code === 'CUSTOM_SERVICE'
              ? e.message
              : 'Creation could not complete. Refresh services before retrying.'
        }
      }
    }
  }
}
