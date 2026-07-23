module.exports = function inertiaRedirect(url) {
  if (this.req.header?.('X-Inertia')) {
    this.res.set('X-Inertia-Location', url)
    return this.res.status(409).end()
  }

  return this.res.redirect(url)
}
