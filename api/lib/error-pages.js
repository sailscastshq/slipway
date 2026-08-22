const STATUS_PAGES = Object.freeze({
  403: {
    title: 'Access denied',
    headline: 'This area is not available',
    message:
      'Your account does not have access to this part of Slipway. If that seems wrong, ask your Slipway administrator.',
    primaryAction: { label: 'Return to Slipway', type: 'home' }
  },
  404: {
    title: 'Page not found',
    headline: 'Nothing is here',
    message: 'The page may have moved, or the link may no longer be available.',
    primaryAction: { label: 'Return to Slipway', type: 'home' }
  },
  419: {
    title: 'Session expired',
    headline: 'Your session has expired',
    message: 'Sign in again to continue safely from where you left off.',
    primaryAction: { label: 'Sign in again', type: 'login' },
    secondaryAction: { label: 'Return to Slipway', type: 'home' }
  },
  429: {
    title: 'Too many requests',
    headline: 'Give it a moment',
    message:
      'Slipway is receiving too many requests from this connection. Wait a minute, then try again.',
    primaryAction: { label: 'Try again', type: 'retry' },
    secondaryAction: { label: 'Return to Slipway', type: 'home' }
  },
  500: {
    title: 'Server error',
    headline: 'Something went wrong',
    message:
      'Slipway could not load this page. Try again, or return to your dashboard.',
    primaryAction: { label: 'Try again', type: 'retry' },
    secondaryAction: { label: 'Return to Slipway', type: 'home' }
  },
  503: {
    title: 'Service unavailable',
    headline: 'Slipway is temporarily unavailable',
    message:
      'We are finishing some work behind the scenes. Try again in a moment.',
    primaryAction: { label: 'Try again', type: 'retry' },
    secondaryAction: { label: 'Return to Slipway', type: 'home' }
  }
})

const SUPPORTED_STATUSES = Object.freeze(Object.keys(STATUS_PAGES).map(Number))

function renderErrorPage(req, res, options = {}) {
  const status = resolveStatus(options.statusCode, options.error)
  const page = STATUS_PAGES[status] || STATUS_PAGES[500]
  const currentPath = resolveCurrentPath(req)
  const props = {
    status,
    title: page.title,
    headline: page.headline,
    message: page.message,
    actions: resolveActions(page, currentPath)
  }

  if (status >= 500) {
    req._sails.log?.error?.('Server error:', options.error || page.title)
  }

  if (status === 429) {
    const retryAfter = Number(options.retryAfter || 60)
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
      res.set('Retry-After', String(Math.round(retryAfter)))
    }
  }

  if (isInertiaRequest(req) || options.inertia === true) {
    res.status(status)
    return req._sails.inertia.render(req, res, {
      page: 'errors/status',
      props
    })
  }

  if (wantsJson(req)) {
    return res.status(status).json({
      error: {
        status,
        title: page.title,
        message: page.message
      }
    })
  }

  if (
    process.env.NODE_ENV !== 'production' &&
    status >= 500 &&
    options.preview !== true
  ) {
    return req._sails.inertia.handleErrorPage(req, res, {
      statusCode: status,
      error: options.error
    })
  }

  res.status(status)
  return res.view('error', props, (viewError, html) => {
    if (viewError) {
      req._sails.log?.warn?.(
        `Could not render the ${status} recovery page.`,
        viewError
      )
      return res.type('text/plain').send(`${status} ${page.title}`)
    }

    return res.send(html)
  })
}

function resolveStatus(statusCode, error) {
  const requested = Number(
    statusCode ||
      (error && typeof error === 'object'
        ? error.statusCode || error.status
        : null) ||
      500
  )

  return SUPPORTED_STATUSES.includes(requested) ? requested : 500
}

function resolveCurrentPath(req) {
  const path = String(req.originalUrl || req.url || '/')
  return path.startsWith('/') && !path.startsWith('//') ? path : '/'
}

function resolveActions(page, currentPath) {
  return [page.primaryAction, page.secondaryAction]
    .filter(Boolean)
    .map((action) => ({
      label: action.label,
      type: action.type,
      href: resolveActionHref(action.type, currentPath)
    }))
}

function resolveActionHref(type, currentPath) {
  if (type === 'retry') return currentPath
  if (type === 'login') {
    return `/login?redirect=${encodeURIComponent(currentPath)}`
  }
  return '/'
}

function isInertiaRequest(req) {
  return String(req.get?.('X-Inertia') || '').toLowerCase() === 'true'
}

function wantsJson(req) {
  if (req.wantsJSON) return true

  const accept = String(req.get?.('Accept') || '').toLowerCase()
  return accept.includes('application/json') && !accept.includes('text/html')
}

module.exports = {
  STATUS_PAGES,
  SUPPORTED_STATUSES,
  renderErrorPage
}
