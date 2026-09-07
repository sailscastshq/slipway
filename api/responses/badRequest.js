module.exports = function badRequest(optionalData) {
  // Send an explicit 303 in both HTTP and virtual transports. Express resets
  // status().redirect() to 302, while Sails' virtual redirect rejects the
  // two-argument Express API. A Location response works correctly in both.
  if (this.req.header?.('X-Inertia') && !this.req.header?.('Precognition')) {
    const humanizeValidationErrors = require('inertia-sails/lib/helpers/humanize-validation-errors')
    const errors = humanizeValidationErrors(optionalData)

    if (Object.keys(errors).length > 0) {
      this.req.session = this.req.session || {}
      this.req.session.errors = errors
      return this.res
        .status(303)
        .set('Location', this.req.get('Referrer') || '/')
        .send('See Other')
    }
  }

  return this.req._sails.inertia.handleBadRequest(
    this.req,
    this.res,
    optionalData
  )
}
