module.exports = function badRequest(optionalData) {
  // inertia-sails 1.5 uses Express's removed two-argument redirect signature
  // for this path. Preserve its normal validation-error contract while using
  // the Sails/Express v4-compatible status + redirect form.
  if (this.req.header?.('X-Inertia') && !this.req.header?.('Precognition')) {
    const humanizeValidationErrors = require('inertia-sails/lib/helpers/humanize-validation-errors')
    const errors = humanizeValidationErrors(optionalData)

    if (Object.keys(errors).length > 0) {
      this.req.session = this.req.session || {}
      this.req.session.errors = errors
      return this.res.status(303).redirect(this.req.get('Referrer') || '/')
    }
  }

  return this.req._sails.inertia.handleBadRequest(
    this.req,
    this.res,
    optionalData
  )
}
