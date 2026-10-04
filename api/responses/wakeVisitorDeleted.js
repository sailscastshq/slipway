/** A deleted visitor's detail URL must not be revisited after success. */
module.exports = function wakeVisitorDeleted(data) {
  const { slug, envSlug, appSlug } = this.req.params
  const location = `/projects/${encodeURIComponent(
    slug
  )}/environments/${encodeURIComponent(envSlug)}/apps/${encodeURIComponent(
    appSlug
  )}/wake?tab=journeys`
  return require('./mutationSuccess').call(this, data, { location })
}
