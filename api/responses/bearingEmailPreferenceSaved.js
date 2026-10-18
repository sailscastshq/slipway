module.exports = function bearingEmailPreferenceSaved(data) {
  if (this.req.header?.('X-Inertia'))
    this.req._sails.inertia.flash('bearingEmailPreference', {
      enabled: data.enabled
    })
  return require('./mutationSuccess').call(
    this,
    { enabled: data.enabled },
    { location: data.location }
  )
}
