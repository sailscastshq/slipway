module.exports = function inertiaRedirect(url) {
  // For Inertia requests, always use 303 so the client follows the redirect
  // as a GET visit (SPA-style) and onSuccess fires properly.
  // The upstream inertia.location() sends 409 for POST which causes a hard
  // page reload and prevents onSuccess from firing.
  if (this.req.get('X-Inertia')) {
    return this.res.redirect(303, url)
  }
  return this.res.redirect(url)
}
