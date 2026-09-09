const custom = require('../../../../lib/custom-service')
module.exports = {
  friendlyName: 'Review custom service',
  inputs: {
    projectSlug: { type: 'string', required: true },
    environmentSlug: { type: 'string', defaultsTo: 'production' },
    definition: { type: 'ref', required: true }
  },
  exits: {
    success: { statusCode: 200 },
    notFound: { statusCode: 404 },
    badRequest: { responseType: 'badRequest' },
    forbidden: { statusCode: 403 }
  },
  fn: async function ({ projectSlug, environmentSlug, definition }) {
    const project = await Project.findOne({ slug: projectSlug })
    const environment =
      project &&
      (await Environment.findOne({
        project: project.id,
        slug: environmentSlug
      }))
    if (!environment) throw 'notFound'
    let actor
    try {
      actor = await custom.authorize(this.req, environment.id)
    } catch {
      throw 'forbidden'
    }
    try {
      custom.validate({ ...definition, appIds: [] })
      const image = await custom.inspectImage(definition.image)
      const effective = custom.validate(definition, image.Config)
      if (
        await Service.findOne({
          environment: environment.id,
          name: effective.name
        })
      )
        custom.fail('A service with this name already exists.')
      const apps = await App.find({ environment: environment.id })
      if (
        effective.appIds.some(
          (id) => !apps.some((app) => String(app.id) === id)
        )
      )
        custom.fail('Choose apps from this environment.')
      await CustomServiceReview.destroy({
        expiresAt: { '<': Date.now() },
        serviceId: null
      })
      if (
        (await CustomServiceReview.count({
          actor: actor.user.id,
          expiresAt: { '>': Date.now() }
        })) >= 20
      )
        custom.fail(
          'There are too many active reviews. Wait for an earlier review to expire.'
        )
      const review = await CustomServiceReview.create({
        token: require('node:crypto').randomUUID(),
        actor: actor.user.id,
        environment: environment.id,
        definition: effective,
        imageReference: image.Id,
        imageMetadata: {
          healthConfigured: Boolean(
            image.Config.Healthcheck?.Test?.length &&
              image.Config.Healthcheck.Test[0] !== 'NONE'
          )
        },
        expiresAt: Date.now() + 10 * 60 * 1000
      }).fetch()
      return {
        review: {
          id: review.token,
          expiresAt: review.expiresAt,
          imageReference: image.Id,
          ...custom.publicDefinition(effective),
          health:
            effective.healthCommand.length ||
            review.imageMetadata.healthConfigured
              ? effective.healthCommand.length
                ? 'Custom health check'
                : 'Image health check'
              : 'Unverified — no health check',
          dockerCommand: `docker create --network <Slipway network> --restart unless-stopped --cap-drop ALL --security-opt no-new-privileges --pids-limit 256 --cpus ${
            effective.cpus
          } --memory ${effective.memoryMiB}m --memory-swap ${
            effective.memoryMiB
          }m ${effective.volumes
            .map(
              (p) => `--mount type=volume,source=<managed volume>,target=${p}`
            )
            .join(' ')} ${
            Object.keys(effective.env).length
              ? '--env-file <private environment>'
              : ''
          } ${
            effective.healthCommand.length
              ? '--health-cmd <custom health check omitted> --health-interval 5s --health-timeout 3s --health-retries 3'
              : ''
          } ${image.Id} ${
            effective.command.length ? '<custom command omitted>' : ''
          }`
        }
      }
    } catch (e) {
      throw {
        badRequest: {
          message:
            e.code === 'CUSTOM_SERVICE'
              ? e.message
              : 'The service could not be reviewed. Check Docker availability and retry.'
        }
      }
    }
  }
}
