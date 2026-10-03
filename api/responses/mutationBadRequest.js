/** Opt-in page validation; leave unrelated API failure transports alone. */
module.exports = function mutationBadRequest(data) {
  if (this.req.header?.('X-Inertia') && !this.req.header?.('Precognition')) {
    const errors =
      require('inertia-sails/lib/helpers/humanize-validation-errors')(data)
    if (!Object.keys(errors).length && !(data instanceof Error)) {
      const message =
        typeof data === 'string' ? data : data?.message || data?.error
      if (typeof message === 'string')
        errors[data?.field || 'settings'] = [message]
    }
    if (Object.keys(errors).length) {
      this.req.session ||= {}
      this.req.session.errors = errors
      return this.res
        .status(303)
        .set('Location', require('../lib/mutation-return-path')(this.req))
        .send('See Other')
    }
  }
  return require('./badRequest').call(this, data)
}
