const crypto = require('node:crypto')
const sharp = require('sharp')
const store = require('../../lib/app-appearance-store')
const { validate } = require('../../lib/app-appearance')
module.exports = {
  friendlyName: 'Update app appearance',
  inputs: {
    slug: { type: 'string', required: true },
    envSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true },
    appearance: { type: 'ref' },
    reset: { type: 'boolean', defaultsTo: false }
  },
  exits: {
    success: { responseType: 'inertiaRedirect' },
    badRequest: { statusCode: 400 },
    notFound: { statusCode: 404 },
    forbidden: { statusCode: 403 }
  },
  fn: async function ({ slug, envSlug, appSlug, appearance, reset }) {
    const { user, project, environment, app } =
      await require('../../lib/app-appearance-access').manager({
        req: this.req,
        projectSlug: slug,
        environmentSlug: envSlug,
        appSlug
      })
    let next
    if (!reset) {
      try {
        next = validate(appearance)
        next.displayName = appearance.displayName.trim() || project.name
        const existing = await store.read(app)
        for (const slot of ['logoLight', 'logoDark'])
          next[slot] = await normalizeLogo(appearance[slot], existing[slot])
        if (next.logoDark && !next.logoLight)
          throw new Error('Upload a light logo before adding a dark variant.')
      } catch (error) {
        throw { badRequest: { message: error.message } }
      }
      await sails.helpers.setting.set(store.keyFor(app), JSON.stringify(next))
    } else await Setting.destroy({ key: store.keyFor(app) })
    await sails.helpers.audit.log.with({
      action: 'app.appearance.updated',
      resourceType: 'app',
      resourceId: String(app.id),
      userId: String(user.id),
      teamId: String(user.team),
      ipAddress: this.req.ip,
      details: { reset }
    })
    sails.inertia.flash(
      'success',
      reset ? 'Default appearance restored.' : 'App appearance saved.'
    )
    return `/projects/${project.slug}/environments/${environment.slug}/apps/${app.slug}/appearance`
  }
}
async function normalizeLogo(input, existing) {
  if (input === 'keep') return existing || null
  if (!input) return null
  if (
    typeof input !== 'string' ||
    input.length > 360000 ||
    !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(input)
  )
    throw new Error('Choose a PNG, JPEG or WebP logo smaller than 256 KB.')
  const bytes = Buffer.from(input.split(',')[1], 'base64')
  if (bytes.length > 256 * 1024)
    throw new Error('Choose a logo smaller than 256 KB.')
  try {
    const image = sharp(bytes, {
      limitInputPixels: 4096 * 4096,
      animated: false
    })
    const meta = await image.metadata()
    if (
      !['png', 'jpeg', 'webp'].includes(meta.format) ||
      meta.pages > 1 ||
      !meta.width ||
      !meta.height ||
      meta.width > 4096 ||
      meta.height > 4096
    )
      throw new Error('invalid')
    const data = await image
      .resize({
        width: 1024,
        height: 1024,
        fit: 'inside',
        withoutEnlargement: true
      })
      .webp({ quality: 90 })
      .toBuffer()
    return {
      data: data.toString('base64'),
      hash: crypto.createHash('sha256').update(data).digest('hex').slice(0, 16)
    }
  } catch {
    throw new Error(
      'Choose a valid still logo no larger than 4096 × 4096 pixels.'
    )
  }
}
module.exports._private = { normalizeLogo }
