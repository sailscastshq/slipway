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
  return `(${bearingBootstrap.toString()})();`
}

function bearingBootstrap() {
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

      const side = config.side === 'left' ? 'left' : 'right'
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
      document.body.append(host)

      const root = host.attachShadow({ mode: 'open' })
      root.innerHTML = `
        <style>
          :host {
            all: initial;
            --bearing-safe-top: env(safe-area-inset-top, 0px);
            --bearing-safe-right: env(safe-area-inset-right, 0px);
            --bearing-safe-bottom: env(safe-area-inset-bottom, 0px);
            --bearing-safe-left: env(safe-area-inset-left, 0px);
          }
          *, *::before, *::after { box-sizing: border-box; }

          .bearing-trigger {
            align-items: center;
            backdrop-filter: blur(16px);
            background: rgb(255 255 255 / 92%);
            border: 1px solid rgb(17 17 17 / 12%);
            border-radius: 14px;
            bottom: calc(20px + var(--bearing-safe-bottom));
            box-shadow: 0 14px 38px -14px rgb(0 0 0 / 36%);
            color: #171717;
            cursor: pointer;
            display: inline-flex;
            font: 600 14px/1 system-ui, sans-serif;
            gap: 10px;
            min-height: 48px;
            padding: 0 15px 0 9px;
            position: fixed;
            transition: transform 160ms ease, box-shadow 160ms ease;
            z-index: 2147483001;
          }

          .bearing-trigger:hover {
            box-shadow: 0 18px 44px -14px rgb(0 0 0 / 42%);
            transform: translateY(-2px);
          }
          .bearing-trigger:focus-visible {
            outline: 3px solid rgb(59 130 246 / 48%);
            outline-offset: 3px;
          }
          .bearing-trigger[hidden] { display: none; }
          .bearing-trigger[data-side='right'] { right: calc(20px + var(--bearing-safe-right)); }
          .bearing-trigger[data-side='left'] { left: calc(20px + var(--bearing-safe-left)); }
          .bearing-trigger[aria-expanded='true'] {
            padding: 0;
            width: 48px;
            justify-content: center;
          }
          .bearing-trigger[aria-expanded='true']:hover { transform: none; }
          .bearing-trigger[aria-expanded='true'] .bearing-trigger-mark {
            background: transparent;
            color: inherit;
            font-size: 26px;
          }
          .bearing-trigger-mark {
            align-items: center;
            background: #171717;
            border-radius: 9px;
            color: #fff;
            display: inline-flex;
            font: 600 15px/1 system-ui, sans-serif;
            height: 30px;
            justify-content: center;
            width: 30px;
          }

          .bearing-panel {
            background: transparent;
            border: 0;
            bottom: calc(76px + var(--bearing-safe-bottom));
            color: #111;
            height: min(620px, calc(100dvh - 108px - var(--bearing-safe-bottom) - var(--bearing-safe-top)));
            inset-block-start: auto;
            margin: 0;
            max-height: none;
            max-width: none;
            overflow: visible;
            padding: 0;
            position: fixed;
            width: min(420px, calc(100vw - 40px - var(--bearing-safe-left) - var(--bearing-safe-right)));
            z-index: 2147483000;
          }
          .bearing-panel[data-side='right'] { left: auto; right: calc(20px + var(--bearing-safe-right)); }
          .bearing-panel[data-side='left'] { left: calc(20px + var(--bearing-safe-left)); right: auto; }
          .bearing-panel[data-opened-from='host'] { bottom: 20px; }
          .bearing-panel[open] { display: block; }
          .bearing-panel-surface {
            background: #fff;
            border: 1px solid #dedede;
            border-radius: 20px;
            box-shadow: 0 24px 70px rgb(0 0 0 / 22%);
            display: grid;
            grid-template-rows: 52px minmax(0, 1fr) auto 30px;
            height: 100%;
            overflow: hidden;
          }
          .bearing-panel[open] .bearing-panel-surface {
            animation: bearing-panel-in 180ms cubic-bezier(.2, .8, .2, 1);
          }
          .bearing-panel[data-closing] .bearing-panel-surface {
            animation: bearing-panel-out 140ms ease-in both;
          }
          .bearing-panel[data-closing] .bearing-trigger {
            opacity: 0;
            transform: scale(.9);
            transition: opacity 140ms ease-in, transform 140ms ease-in;
          }
          .bearing-panel-close[hidden] { display: none; }
          .bearing-panel::backdrop { background: transparent; }

          .bearing-panel-header {
            align-items: center;
            background: #fff;
            border-bottom: 1px solid #ececec;
            color: #111;
            display: flex;
            font: 600 14px/1 system-ui, sans-serif;
            justify-content: space-between;
            padding: 0 10px 0 16px;
          }
          .bearing-panel-close {
            align-items: center;
            background: transparent;
            border: 0;
            border-radius: 10px;
            color: #777;
            cursor: pointer;
            display: inline-flex;
            font: 500 22px/1 system-ui, sans-serif;
            height: 36px;
            justify-content: center;
            padding: 0;
            width: 36px;
          }
          .bearing-panel-close:hover { background: #f4f4f4; color: #111; }
          .bearing-panel-close:focus-visible {
            outline: 2px solid #3b82f6;
            outline-offset: 1px;
          }
          .bearing-panel iframe {
            background: #fff;
            border: 0;
            display: block;
            height: 100%;
            width: 100%;
          }
          .bearing-panel-nav {
            background: #fafafa;
            display: grid;
            gap: 4px;
            grid-auto-columns: minmax(0, 1fr);
            grid-auto-flow: column;
            padding: 8px;
          }
          .bearing-panel-nav button {
            align-items: center;
            background: transparent;
            border: 0;
            border-radius: 10px;
            color: #777;
            cursor: pointer;
            display: inline-flex;
            font: 500 13px/1 system-ui, sans-serif;
            justify-content: center;
            min-height: 44px;
            padding: 0 10px;
          }
          .bearing-panel-nav button:hover { background: #f0f0f0; color: #111; }
          .bearing-panel-nav button:focus-visible {
            outline: 2px solid #3b82f6;
            outline-offset: -2px;
          }
          .bearing-panel-nav button[aria-current='page'] {
            background: #fff;
            box-shadow: 0 1px 4px rgb(0 0 0 / 10%);
            color: #111;
            font-weight: 650;
          }
          .bearing-panel-nav button[hidden] { display: none; }
          .bearing-powered-by {
            align-items: center;
            background: #fafafa;
            color: #999;
            display: flex;
            font: 500 11px/1 system-ui, sans-serif;
            justify-content: center;
            text-decoration: none;
          }
          .bearing-powered-by:hover { color: #555; }
          .bearing-powered-by:focus-visible {
            border-radius: 4px;
            outline: 2px solid #3b82f6;
            outline-offset: -1px;
          }

          @keyframes bearing-panel-in {
            from { opacity: 0; transform: translateY(10px) scale(.985); }
            to { opacity: 1; transform: translateY(0) scale(1); }
          }

          @keyframes bearing-panel-out {
            from { opacity: 1; transform: translateY(0) scale(1); }
            to { opacity: 0; transform: translateY(10px) scale(.985); }
          }

          @media (prefers-color-scheme: dark) {
            .bearing-trigger {
              background: rgb(17 17 17 / 92%);
              border-color: rgb(255 255 255 / 16%);
              color: #fff;
            }
            .bearing-trigger-mark { background: #fff; color: #171717; }
            .bearing-panel-surface { background: #030712; border-color: #30343b; }
            .bearing-panel-header {
              background: #030712;
              border-color: #20242b;
              color: #fff;
            }
            .bearing-panel-close { color: #aaa; }
            .bearing-panel-close:hover { background: #171b22; color: #fff; }
            .bearing-panel iframe { background: #030712; }
            .bearing-panel-nav,
            .bearing-powered-by { background: #090d14; }
            .bearing-panel-nav button { color: #999; }
            .bearing-panel-nav button:hover {
              background: #171b22;
              color: #fff;
            }
            .bearing-panel-nav button[aria-current='page'] {
              background: #1d222b;
              box-shadow: none;
              color: #fff;
            }
            .bearing-powered-by:hover { color: #ddd; }
          }

          @media (max-width: 640px) {
            .bearing-trigger { bottom: calc(12px + var(--bearing-safe-bottom)); }
            .bearing-trigger[data-side='right'] { right: calc(12px + var(--bearing-safe-right)); }
            .bearing-trigger[data-side='left'] { left: calc(12px + var(--bearing-safe-left)); }
            .bearing-panel {
              bottom: 0;
              height: min(760px, calc(100dvh - 16px));
              width: 100vw;
            }
            .bearing-panel[data-side='right'],
            .bearing-panel[data-side='left'] {
              left: 0;
              right: 0;
            }
            .bearing-panel[data-opened-from='host'] { bottom: 0; }
            .bearing-panel[data-opened-from='widget'] {
              bottom: calc(72px + var(--bearing-safe-bottom));
              height: min(760px, calc(100dvh - 88px - var(--bearing-safe-bottom) - var(--bearing-safe-top)));
              width: calc(100vw - 24px - var(--bearing-safe-left) - var(--bearing-safe-right));
            }
            .bearing-panel[data-opened-from='widget'][data-side='right'] { left: auto; right: calc(12px + var(--bearing-safe-right)); }
            .bearing-panel[data-opened-from='widget'][data-side='left'] { left: calc(12px + var(--bearing-safe-left)); right: auto; }
            .bearing-panel[data-opened-from='host'] .bearing-panel-surface {
              border-bottom: 0;
              border-radius: 20px 20px 0 0;
            }
            .bearing-panel[open]:not([data-closing]) .bearing-panel-surface {
              animation-name: bearing-sheet-in;
            }
            .bearing-panel-surface {
              grid-template-rows:
                52px minmax(0, 1fr) auto
                calc(30px + var(--bearing-safe-bottom));
            }
            .bearing-powered-by {
              padding-bottom: var(--bearing-safe-bottom);
            }
          }

          @media (prefers-reduced-motion: reduce) {
            .bearing-panel[open] .bearing-panel-surface { animation: none; }
            .bearing-trigger { transition: none !important; }
          }

          @keyframes bearing-sheet-in {
            from { opacity: .96; transform: translateY(100%); }
            to { opacity: 1; transform: translateY(0); }
          }
        </style>
        <button
          type="button"
          class="bearing-trigger"
          data-trigger
          data-side="${side}"
          aria-haspopup="dialog"
          aria-expanded="false"
          aria-controls="slipway-bearing-panel"
        ></button>
        <dialog
          id="slipway-bearing-panel"
          class="bearing-panel"
          data-panel
          data-side="${side}"
          data-opened-from="host"
          aria-labelledby="slipway-bearing-title"
          aria-modal="true"
        >
          <div class="bearing-panel-surface">
          <header class="bearing-panel-header">
            <span id="slipway-bearing-title">${escapeHtml(
              config.appName
            )}</span>
            <button
              type="button"
              class="bearing-panel-close"
              data-close
              aria-label="Close"
            >×</button>
          </header>
          <iframe data-frame title="${escapeHtml(
            config.appName
          )} Feedback"></iframe>
          <nav class="bearing-panel-nav" aria-label="Bearing">
            <button type="button" data-surface="feedback">Feedback</button>
            <button type="button" data-surface="roadmap">Roadmap</button>
            <button type="button" data-surface="updates">Updates</button>
          </nav>
          <a
            class="bearing-powered-by"
            href="https://docs.sailscasts.com/slipway"
            target="_blank"
            rel="noreferrer"
          >Powered by Slipway</a>
          </div>
        </dialog>
      `

      const trigger = root.querySelector('[data-trigger]')
      const panel = root.querySelector('[data-panel]')
      const closeButton = root.querySelector('[data-close]')
      const frame = root.querySelector('[data-frame]')
      const surfaceButtons = root.querySelectorAll('[data-surface]')

      function paintTrigger() {
        trigger.setAttribute('aria-expanded', String(open))
        trigger.hidden = open ? !openedFromInjectedTrigger : !fresh
        closeButton.hidden = open && openedFromInjectedTrigger
        if (open && openedFromInjectedTrigger) {
          trigger.innerHTML =
            '<span class="bearing-trigger-mark" aria-hidden="true">×</span>'
          trigger.setAttribute(
            'aria-label',
            `Close what’s new for ${config.appName}`
          )
        } else if (fresh) {
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
        if (frame.getAttribute('src') !== surfaces[surface].path) {
          frame.src = surfaces[surface].path
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
        opener = nextOpener || document.activeElement
        openedFromInjectedTrigger = opener === trigger
        panel.dataset.openedFrom = openedFromInjectedTrigger ? 'widget' : 'host'
        // Moving the same button into the dialog keeps it in the native top
        // layer, including when the browser makes the host document inert.
        if (openedFromInjectedTrigger) panel.prepend(trigger)
        else root.insertBefore(trigger, panel)
        open = true
        setSurface(surface)
        if (!panel.open) panel.showModal()
        lockHostScroll()
        requestAnimationFrame(() => {
          if (transition !== transitionId || !open) return
          ;(openedFromInjectedTrigger ? trigger : closeButton).focus()
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
          if (previousOpener?.isConnected && previousOpener !== trigger) {
            previousOpener.focus()
          }
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
      closeButton.addEventListener('click', closePanel)
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
      frame.addEventListener('load', listenForFrameEscape)
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

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (character) => {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[character]
    })
  }
}
