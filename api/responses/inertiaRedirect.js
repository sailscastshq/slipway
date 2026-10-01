module.exports = function inertiaRedirect(url) {
  if (this.req.header?.('X-Inertia')) {
    // Reserve a full browser navigation for external destinations.
    if (/^(?:https?:)?\/\//i.test(url)) {
      this.res.set('X-Inertia-Location', url)
      return this.res.status(409).end()
    }
    this.res.set('Location', url === 'back' ? '/' : url)
    return this.res.status(303).end()
  }
  return this.res.redirect(url)
}
