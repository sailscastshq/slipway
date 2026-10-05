/** A deleted visitor's detail URL must not be revisited after success. */
module.exports = function wakeVisitorDeleted(data) {
  const { slug, envSlug, appSlug } = this.req.params
  const parent = `/projects/${encodeURIComponent(
    slug
  )}/environments/${encodeURIComponent(envSlug)}/apps/${encodeURIComponent(
    appSlug
  )}/wake`
  const previous = new URL(
    require('../lib/mutation-return-path')(this.req),
    'http://slipway.invalid'
  )
  const query = new URLSearchParams({ tab: 'journeys' })
  if (previous.pathname === parent)
    for (const key of ['from', 'to', 'currency'])
      if (previous.searchParams.has(key))
        query.set(key, previous.searchParams.get(key))
  const location = `${parent}?${query}`
  return require('./mutationSuccess').call(this, data, { location })
}
