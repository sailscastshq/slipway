const widgetShell = require('../../lib/bearing-widget-shell')
module.exports = {
  friendlyName: 'View Bearing bootstrap',

  description: 'Serve the CSP-safe, same-origin Bearing widget bootstrap.',

  inputs: {
    projectSlug: { type: 'string', required: true },
    environmentSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true }
  },

  fn: async function () {
    this.res.set('Cache-Control', 'public, max-age=300')
    this.res.set('Content-Type', 'application/javascript; charset=utf-8')
    return bootstrapSource()
  }
}

function bootstrapSource() {
  return `(${bearingBootstrap.toString()})(${widgetShell.toString()});`
}

function bearingBootstrap(widgetShell) {
  const script = document.currentScript
  if (!script || script.dataset.slipwayBearingReady) return
  script.dataset.slipwayBearingReady = 'true'

  const configUrl = new URL('widget-config', script.src).href
  fetch(configUrl, {
    credentials: 'include',
    headers: { Accept: 'application/json' }
  })
    .then((response) => (response.ok ? response.json() : null))
    .then((config) => {
      if (!config?.enabled) return

      const surfaceOrder = ['feedback', 'roadmap', 'updates']
      const surfaces = Object.fromEntries(
        surfaceOrder
          .filter((key) => config.surfaces?.[key]?.path)
          .map((key) => [key, config.surfaces[key]])
      )
      const openingView = surfaces[config.openingView]
        ? config.openingView
        : surfaceOrder.find((key) => surfaces[key])
      if (!openingView) return

      const seenKey = `slipway:bearing:${config.space}:seen-update`
      const latestUpdateId = config.latestUpdate?.publicId || ''
      let open = false
      let currentSurface = openingView
      let opener = null
      let openedFromInjectedTrigger = false
      let launcherReturnFocus = null
      let hostScrollState = null
      let transitionId = 0
      let closeTimer = null
      let fresh = Boolean(
        config.showUnread &&
          latestUpdateId &&
          surfaces.updates &&
          readStorage(seenKey) !== latestUpdateId
      )

      const host = document.createElement('div')
      host.dataset.slipwayBearingWidget = ''
      if (config.appearance?.configured) host.dataset.appAppearance = '1'
      host.hidden = true
      document.body.append(host)

      const root = host.attachShadow({ mode: 'open' })
      root.innerHTML = widgetShell(config)

      Promise.all(
        Array.from(root.querySelectorAll('link[rel="stylesheet"]')).map(
          (link) =>
            new Promise((resolve) => {
              link.addEventListener('load', resolve, { once: true })
              link.addEventListener('error', resolve, { once: true })
              if (link.sheet) resolve()
            })
        )
      ).then(() => {
        host.hidden = false
      })
      const trigger = root.querySelector('[data-trigger]')
      const panel = root.querySelector('[data-panel]')
      const frame = root.querySelector('[data-frame]')
      const surfaceButtons = root.querySelectorAll('[data-surface]')
      const appearance = config.appearance
      const media = window.matchMedia('(prefers-color-scheme: dark)')
      let currentMode
      let logo
      if (appearance?.configured && appearance.logoLight) {
        logo = document.createElement('img')
        logo.className = 'bearing-app-logo'
        logo.alt = appearance.logoText || ''
        logo.addEventListener('error', () => {
          logo.hidden = true
        })
        root.querySelector('#slipway-bearing-title').prepend(logo)
      }
      function resolvedMode() {
        const saved = appearance?.mode || 'system'
        if (saved === 'light' || saved === 'dark') return saved
        if (saved === 'host') {
          const element = document.documentElement
          const mapping = element.dataset.theme || element.dataset.colorScheme
          if (mapping === 'light' || mapping === 'dark') return mapping
          if (element.classList.contains('dark')) return 'dark'
          if (element.classList.contains('light')) return 'light'
          const fallback = appearance.fallbackMode
          if (fallback === 'light' || fallback === 'dark') return fallback
        }
        return media.matches ? 'dark' : 'light'
      }
      function syncAppearance() {
        currentMode = resolvedMode()
        host.dataset.appearanceMode = currentMode
        if (logo) {
          logo.src =
            currentMode === 'dark' && appearance.logoDark
              ? appearance.logoDark
              : appearance.logoLight
          logo.classList.toggle('bearing-app-logo-single', !appearance.logoDark)
        }
        try {
          if (
            appearance?.mode === 'host' &&
            frame.contentWindow &&
            frame.contentWindow.location.origin === window.location.origin
          ) {
            frame.contentWindow.postMessage(
              { type: 'slipway:appearance', version: 1, mode: currentMode },
              window.location.origin
            )
          }
        } catch {
          /* Only the expected same-origin frame receives mode changes. */
        }
      }
      media.addEventListener('change', syncAppearance)
      if (appearance?.mode === 'host')
        new MutationObserver(syncAppearance).observe(document.documentElement, {
          attributes: true,
          attributeFilter: ['class', 'data-theme', 'data-color-scheme']
        })
      syncAppearance()

      function paintTrigger() {
        trigger.setAttribute('aria-expanded', String(open))
        trigger.hidden = !open && !fresh
        if (open) {
          trigger.innerHTML =
            '<span class="bearing-trigger-mark" aria-hidden="true">×</span>'
          trigger.setAttribute(
            'aria-label',
            `Close what’s new for ${config.appName}`
          )
        } else {
          trigger.innerHTML =
            '<span class="bearing-trigger-mark" aria-hidden="true">✦</span><span>What’s new</span>'
          trigger.setAttribute(
            'aria-label',
            `Open what’s new for ${config.appName}`
          )
          return
        }
      }

      function paintSurfaceNavigation() {
        surfaceButtons.forEach((button) => {
          const surface = button.dataset.surface
          button.hidden = !surfaces[surface]
          if (surface === currentSurface) {
            button.setAttribute('aria-current', 'page')
          } else {
            button.removeAttribute('aria-current')
          }
        })
      }

      function markLatestSeen() {
        if (!latestUpdateId) return
        writeStorage(seenKey, latestUpdateId)
        fresh = false
      }

      function setSurface(surface) {
        if (!surfaces[surface]) return false
        currentSurface = surface
        const url = new URL(surfaces[surface].path, window.location.href)
        if (appearance?.mode === 'host')
          url.searchParams.set('appearanceMode', currentMode)
        if (frame.dataset.bearingSurface !== surface) {
          frame.src = url.pathname + url.search
          frame.dataset.bearingSurface = surface
        }
        frame.title = `${config.appName} ${surfaces[surface].label}`
        if (surface === 'updates') markLatestSeen()
        paintSurfaceNavigation()
        paintTrigger()
        return true
      }

      function lockHostScroll() {
        if (hostScrollState) return
        hostScrollState = {
          documentElement: document.documentElement.style.overflow,
          body: document.body.style.overflow
        }
        document.documentElement.style.overflow = 'hidden'
        document.body.style.overflow = 'hidden'
      }

      function unlockHostScroll() {
        if (!hostScrollState) return
        document.documentElement.style.overflow =
          hostScrollState.documentElement
        document.body.style.overflow = hostScrollState.body
        hostScrollState = null
      }

      function openPanel(surface = openingView, nextOpener = null) {
        if (!surfaces[surface]) return false
        const transition = ++transitionId
        clearTimeout(closeTimer)
        panel.removeAttribute('data-closing')
        const requestedOpener = nextOpener || document.activeElement
        if (
          !open ||
          (requestedOpener !== host && !panel.contains(requestedOpener))
        )
          opener = requestedOpener
        openedFromInjectedTrigger = requestedOpener === trigger
        panel.dataset.openedFrom = openedFromInjectedTrigger ? 'widget' : 'host'
        // Moving the same button into the dialog keeps it in the native top
        // layer, including when the browser makes the host document inert.
        panel.prepend(trigger)
        open = true
        setSurface(surface)
        if (!panel.open) panel.showModal()
        lockHostScroll()
        requestAnimationFrame(() => {
          if (transition !== transitionId || !open) return
          trigger.focus()
        })
        return true
      }

      function closePanel() {
        if (!open || panel.hasAttribute('data-closing')) return
        const transition = ++transitionId
        const previousOpener = opener
        const finish = () => {
          if (transition !== transitionId) return
          if (panel.open) panel.close()
          panel.removeAttribute('data-closing')
          open = false
          opener = null
          openedFromInjectedTrigger = false
          root.insertBefore(trigger, panel)
          unlockHostScroll()
          paintTrigger()
          const returnTarget =
            previousOpener === trigger
              ? trigger.hidden
                ? launcherReturnFocus
                : trigger
              : previousOpener
          if (returnTarget?.isConnected) returnTarget.focus()
        }
        panel.setAttribute('data-closing', '')
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          finish()
        } else {
          closeTimer = setTimeout(finish, 140)
        }
      }

      function requestedSurface(element) {
        const requested = element.getAttribute('data-slipway-bearing-open')
        return requested === null ? null : requested || openingView
      }

      function shouldKeepLinkNavigation(event, link) {
        return Boolean(
          event.defaultPrevented ||
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey ||
            link.hasAttribute('download') ||
            (link.target && link.target !== '_self')
        )
      }

      function handleHostTrigger(event) {
        const target = event.target
        if (!target?.closest) return
        const element = target.closest('[data-slipway-bearing-open]')
        if (!element) return
        const surface = requestedSurface(element)
        if (!surfaces[surface]) return
        if (
          element.tagName === 'A' &&
          shouldKeepLinkNavigation(event, element)
        ) {
          return
        }
        event.preventDefault()
        openPanel(surface, element)
      }

      function trapPanelFocus(event) {
        if (event.key !== 'Tab') return
        const focusable = panel.querySelectorAll(
          'a[href], button:not([disabled]):not([hidden]), iframe'
        )
        if (!focusable.length) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        const active = root.activeElement
        if (event.shiftKey && active === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && active === last) {
          event.preventDefault()
          first.focus()
        }
      }

      function handleEscape(event) {
        if (!open || event.key !== 'Escape') return
        event.preventDefault()
        closePanel()
      }

      function listenForFrameEscape() {
        try {
          frame.contentWindow?.addEventListener('keydown', handleEscape)
        } catch {
          // The Bearing surfaces are same-origin. If a host policy changes
          // that, the rest of the widget should remain usable.
        }
      }

      paintTrigger()
      paintSurfaceNavigation()
      trigger.addEventListener('click', () => {
        if (open) closePanel()
        else openPanel('updates', trigger)
      })
      trigger.addEventListener('focus', (event) => {
        if (
          !open &&
          event.relatedTarget?.isConnected &&
          event.relatedTarget !== host
        )
          launcherReturnFocus = event.relatedTarget
      })
      surfaceButtons.forEach((button) => {
        button.addEventListener('click', () =>
          setSurface(button.dataset.surface)
        )
      })
      panel.addEventListener('cancel', (event) => {
        event.preventDefault()
        closePanel()
      })
      panel.addEventListener('keydown', trapPanelFocus)
      frame.addEventListener('load', () => {
        listenForFrameEscape()
        syncAppearance()
      })
      panel.addEventListener('click', (event) => {
        if (event.target !== panel) return
        const bounds = panel.getBoundingClientRect()
        const inside =
          event.clientX >= bounds.left &&
          event.clientX <= bounds.right &&
          event.clientY >= bounds.top &&
          event.clientY <= bounds.bottom
        if (!inside) closePanel()
      })
      document.addEventListener('click', handleHostTrigger, true)
      window.addEventListener('keydown', handleEscape)
      document.addEventListener(
        'mousedown',
        (event) => {
          if (!open) return
          const path = event.composedPath()
          if (path.includes(panel) || path.includes(trigger)) return
          closePanel()
        },
        true
      )
      window.addEventListener('slipway:bearing:open', (event) => {
        const surface = event.detail?.surface || openingView
        if (!surfaces[surface]) return
        openPanel(surface, document.activeElement)
      })
      window.addEventListener('storage', (event) => {
        if (event.key !== seenKey || !latestUpdateId) return
        fresh = Boolean(
          config.showUnread &&
            surfaces.updates &&
            event.newValue !== latestUpdateId
        )
        paintTrigger()
      })
    })
    .catch(() => {})

  function readStorage(key) {
    try {
      return window.localStorage.getItem(key)
    } catch {
      return null
    }
  }

  function writeStorage(key, value) {
    try {
      window.localStorage.setItem(key, value)
    } catch {
      // The widget remains usable when storage is unavailable.
    }
  }
}
