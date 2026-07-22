const INERTIA_HEADERS = {
  'x-inertia': 'true',
  'x-requested-with': 'XMLHttpRequest',
  accept: 'text/html, application/xhtml+xml'
}

async function withCsrfFromPage(request, path, actor) {
  const browserRequest = (actor ? request.as(actor) : request).withHeaders(
    INERTIA_HEADERS
  )
  const page = await browserRequest.get(path)
  const token = page.data?.props?._csrf

  if (!token) {
    const propNames = Object.keys(page.data?.props || {})
    throw new Error(
      `No CSRF token was exposed by ${path}. Props: ${propNames.join(', ')}`
    )
  }

  return {
    request: browserRequest.withHeaders({
      'x-csrf-token': token
    }),
    token,
    page
  }
}

module.exports = {
  INERTIA_HEADERS,
  withCsrfFromPage
}
