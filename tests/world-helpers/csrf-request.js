const Tokens = require('csrf')

const csrfTokens = new Tokens()

const INERTIA_HEADERS = {
  'x-inertia': 'true',
  'x-requested-with': 'XMLHttpRequest',
  accept: 'text/html, application/xhtml+xml'
}

function createCsrfSession(session = {}) {
  const csrfSecret = session.csrfSecret || csrfTokens.secretSync()

  return {
    session: {
      ...session,
      csrfSecret
    },
    token: csrfTokens.create(csrfSecret)
  }
}

async function withCsrfFromPage(request, path, session = {}) {
  const csrf = createCsrfSession(session)
  const browserRequest = request
    .withSession(csrf.session)
    .withHeaders(INERTIA_HEADERS)

  const page = await browserRequest.get(path)
  const token = page.data?.props?._csrf || csrf.token

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
    session: csrf.session,
    token,
    page
  }
}

module.exports = {
  INERTIA_HEADERS,
  createCsrfSession,
  withCsrfFromPage
}
