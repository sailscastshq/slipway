/* Served as an external same-origin script. No application credentials. */
;(function () {
  if (window.slipway?.wake?.installed) return
  const script = document.currentScript
  if (!script) return
  const base = new URL(script.src, location.href)
  base.pathname = base.pathname.replace(/wake\.js$/, 'wake/')
  base.search = ''
  const endpoint = (name) => new URL(name, base).href
  const early = Array.isArray(window.slipway?.wake?.q)
    ? window.slipway.wake.q
    : []
  let pendingCalls = [],
    activeController = null
  let config = null,
    granted = false,
    active = false,
    queue = [],
    lastPath = null,
    sending = false,
    epoch = 0
  let denied = false
  const consentKey = `slipway-wake-consent:${base.pathname}`
  try {
    granted = localStorage.getItem(consentKey) === 'granted'
    denied = localStorage.getItem(consentKey) === 'denied'
  } catch {
    /* storage is optional */
  }
  function privateSignal() {
    return (
      config?.respectPrivacySignals &&
      (navigator.globalPrivacyControl === true ||
        navigator.doNotTrack === '1' ||
        window.doNotTrack === '1')
    )
  }
  function path() {
    return location.pathname
  }
  function excluded(value) {
    const local = value.startsWith(
      base.pathname.replace(/\/_slipway\/wake\/$/, '') + '/'
    )
      ? value.slice(base.pathname.replace(/\/_slipway\/wake\/$/, '').length)
      : value
    return (
      /^\/(?:_slipway|__|health(?:\/|$)|assets(?:\/|$))/i.test(local) ||
      /\.(?:js|css|png|jpe?g|svg|ico|map|woff2?|webp|gif)$/i.test(value) ||
      config.excludedPaths.some((item) =>
        item.endsWith('*')
          ? value.startsWith(item.slice(0, -1))
          : value === item
      )
    )
  }
  function metadata() {
    const campaign = {},
      search = new URLSearchParams(location.search)
    for (const key of [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content'
    ])
      if (search.has(key)) campaign[key] = search.get(key).slice(0, 120)
    let referrer = ''
    try {
      const url = new URL(document.referrer)
      if (/^https?:$/.test(url.protocol)) referrer = url.origin + url.pathname
    } catch {
      /* no referrer */
    }
    return {
      referrer,
      campaign,
      device:
        innerWidth < 768 ? 'mobile' : innerWidth < 1024 ? 'tablet' : 'desktop'
    }
  }
  function capture(name) {
    if (typeof name !== 'string') return
    if (
      !active ||
      privateSignal() ||
      excluded(path()) ||
      !/^[a-z][a-z0-9_.-]{0,63}$/.test(name)
    )
      return
    if (name === 'pageview' && lastPath === path()) return
    if (name === 'pageview') lastPath = path()
    if (!crypto.randomUUID) return
    if (queue.length >= 100) queue.shift()
    queue.push({
      id: crypto.randomUUID(),
      kind: name === 'pageview' ? 'pageview' : 'goal',
      name,
      occurredAt: Date.now(),
      path: path(),
      dimensions: metadata()
    })
    if (queue.length >= 10) void flush()
  }
  async function flush(exit = false) {
    if (!active || sending || !queue.length || privateSignal()) return
    const batch = queue.splice(0, 10),
      currentEpoch = epoch
    const body = JSON.stringify({ consent: granted, events: batch })
    if (
      exit &&
      navigator.sendBeacon?.(
        endpoint('events'),
        new Blob([body], { type: 'application/json' })
      )
    )
      return
    sending = true
    activeController = new AbortController()
    try {
      const response = await fetch(endpoint('events'), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive: true,
        signal: AbortSignal.any([
          activeController.signal,
          AbortSignal.timeout(4000)
        ])
      })
      if (currentEpoch !== epoch) return
      if (response.status === 403 || response.status === 503) {
        active = false
        queue = []
        return
      }
      if (response.ok) {
        const result = await response.json()
        if (result.reset) {
          queue = []
          lastPath = null
          capture('pageview')
        }
      }
    } catch {
      /* best-effort analytics never affect application navigation */
    } finally {
      sending = false
      activeController = null
    }
  }
  function revoke() {
    activeController?.abort()
    epoch++
    queue = []
    active = false
    lastPath = null
    const body = JSON.stringify({ consent: false, events: [] })
    void fetch(endpoint('events'), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
      signal: AbortSignal.timeout(4000)
    }).catch(() => {})
  }
  async function refresh() {
    try {
      const response = await fetch(endpoint('config'), {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(4000)
      })
      if (!response.ok) {
        revoke()
        return
      }
      const previousMode = config?.mode
      config = await response.json()
      const allowed =
        config.enabled &&
        !denied &&
        !privateSignal() &&
        (!config.requireConsent || granted)
      if (!allowed) {
        pendingCalls = []
        if (active) revoke()
        return
      }
      if (previousMode && previousMode !== config.mode) {
        epoch++
        queue = []
        lastPath = null
      }
      if (!active) {
        active = true
        lastPath = null
        capture('pageview')
      }
      const pending = pendingCalls
      pendingCalls = []
      for (const name of pending) capture(name)
    } catch {
      if (active) revoke()
    }
  }
  window.slipway ||= {}
  window.slipway.wake = {
    installed: true,
    track: (name) => {
      if (!config) {
        if (pendingCalls.length < 20 && typeof name === 'string')
          pendingCalls.push(name)
        return
      }
      capture(name)
    },
    consent(value) {
      granted = value === true
      denied = !granted
      try {
        if (granted) localStorage.setItem(consentKey, 'granted')
        else localStorage.setItem(consentKey, 'denied')
      } catch {
        /* optional */
      }
      if (!granted) revoke()
      else void refresh()
    },
    flush: () => flush(),
    getState: () => ({ active, mode: config?.mode || null, consent: granted })
  }
  for (const method of ['pushState', 'replaceState']) {
    const original = history[method]
    history[method] = function () {
      const result = original.apply(this, arguments)
      capture('pageview')
      return result
    }
  }
  addEventListener('popstate', () => capture('pageview'))
  addEventListener('pageshow', (event) => {
    if (event.persisted) void refresh()
  })
  addEventListener('pagehide', () => void flush(true))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush(true)
    else void refresh()
  })
  document.addEventListener('click', (event) => {
    const goal = event.target
      .closest?.('[data-slipway-goal]')
      ?.getAttribute('data-slipway-goal')
    if (goal) capture(goal)
  })
  setInterval(() => void flush(), 5000)
  setInterval(() => void refresh(), 60000)
  for (const delay of [1000, 3000])
    setTimeout(() => {
      if (!active && !denied) void refresh()
    }, delay)
  addEventListener('storage', (event) => {
    if (event.key !== consentKey) return
    granted = event.newValue === 'granted'
    denied = event.newValue === 'denied'
    if (denied || (config?.requireConsent && !granted)) revoke()
    else void refresh()
  })
  for (const command of early.slice(0, 20))
    if (Array.isArray(command) && ['track', 'consent'].includes(command[0]))
      window.slipway.wake[command[0]](command[1])
  void refresh()
})()
