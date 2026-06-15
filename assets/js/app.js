import { createApp, h } from 'vue'
import { createInertiaApp, router } from '@inertiajs/vue3'
import '~/css/app.css'

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function setCsrfToken(token) {
  window.__SLIPWAY_CSRF_TOKEN__ = token || window.__SLIPWAY_CSRF_TOKEN__
}

function isUnsafeMethod(method) {
  return UNSAFE_METHODS.has(String(method || 'GET').toUpperCase())
}

function isRequest(input) {
  return typeof Request !== 'undefined' && input instanceof Request
}

function isSameOrigin(input) {
  const url = new URL(
    isRequest(input) ? input.url : String(input),
    window.location.href
  )

  return url.origin === window.location.origin
}

function withCsrfHeader(headers) {
  const nextHeaders = new Headers(headers || {})

  if (window.__SLIPWAY_CSRF_TOKEN__ && !nextHeaders.has('x-csrf-token')) {
    nextHeaders.set('X-CSRF-Token', window.__SLIPWAY_CSRF_TOKEN__)
  }

  return nextHeaders
}

function withCsrfHeaderObject(headers) {
  return Object.fromEntries(withCsrfHeader(headers).entries())
}

function configureInertiaCsrf() {
  if (typeof window === 'undefined' || window.__SLIPWAY_INERTIA_CSRF_READY__) {
    return
  }

  const originalVisit = router.visit.bind(router)

  router.visit = (href, options = {}) => {
    if (!isUnsafeMethod(options.method)) {
      return originalVisit(href, options)
    }

    return originalVisit(href, {
      ...options,
      headers: withCsrfHeaderObject(options.headers)
    })
  }

  window.__SLIPWAY_INERTIA_CSRF_READY__ = true
}

function configureFetchCsrf() {
  if (typeof window === 'undefined' || window.__SLIPWAY_FETCH_CSRF_READY__) {
    return
  }

  const originalFetch = window.fetch.bind(window)

  window.fetch = (input, init = {}) => {
    const method = init.method || (isRequest(input) ? input.method : 'GET')

    if (!isUnsafeMethod(method) || !isSameOrigin(input)) {
      return originalFetch(input, init)
    }

    return originalFetch(input, {
      ...init,
      headers: withCsrfHeader(
        init.headers || (isRequest(input) ? input.headers : undefined)
      )
    })
  }

  window.__SLIPWAY_FETCH_CSRF_READY__ = true
}

configureInertiaCsrf()
configureFetchCsrf()

createInertiaApp({
  setup({ el, App, props, plugin }) {
    setCsrfToken(props.initialPage?.props?._csrf)

    document.addEventListener('inertia:navigate', (event) => {
      setCsrfToken(event.detail.page?.props?._csrf)
    })

    createApp({ render: () => h(App, props) })
      .use(plugin)
      .mount(el)
  },
  progress: {
    color: '#0284c7'
  }
})
