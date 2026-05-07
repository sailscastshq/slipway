module.exports = function inertia(data = {}) {
  const req = this.req
  const res = this.res

  return req._sails.inertia.render(req, res, {
    ...data,
    props: {
      ...(data.props || {}),
      _csrf: getCsrfToken(req, res)
    }
  })
}

function getCsrfToken(req, res) {
  if (res.locals._csrf) {
    return res.locals._csrf
  }

  if (typeof req.csrfToken === 'function') {
    return req.csrfToken()
  }

  return ''
}
