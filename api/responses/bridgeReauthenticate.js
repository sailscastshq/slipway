module.exports = function bridgeReauthenticate(callback) {
  const req = this.req
  const res = this.res

  if (req.get('X-Inertia') === 'true') {
    return res.status(409).set('X-Inertia-Location', callback).end()
  }

  if (acceptsHtml(req)) {
    return res.status(302).redirect(callback)
  }

  if (req.wantsJSON) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Your Bridge session expired. Reauthenticate to continue.',
      reauthenticate: callback
    })
  }

  return res.status(302).redirect(callback)
}

function acceptsHtml(req) {
  return String(req.get('accept') || '').includes('text/html')
}
