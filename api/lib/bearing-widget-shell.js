// Shared production/preview chrome. Only escaped configuration enters markup.
function widgetShell(config) {
  const side = config.side === 'left' ? 'left' : 'right'
  return `
        <link rel="stylesheet" href="${escapeHtml(config.widgetStyles)}">
        ${
          config.stylesheet
            ? `<link data-appearance-styles rel="stylesheet" href="${escapeHtml(
                config.stylesheet
              )}?widget=1">`
            : ''
        }

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
            href="https://docs.sailscasts.com/slipway/bearing"
            aria-label="Powered by Slipway"
            target="_blank"
            rel="noreferrer"
          ><span>Powered by</span><svg viewBox="0 0 140 32" class="bearing-slipway-lockup" aria-hidden="true" focusable="false" fill="none" xmlns="http://www.w3.org/2000/svg">
  <!-- Slippy — the Slipway octopus -->
  <path
    d="M7 17 C7 3 25 3 25 17 Z"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  />
  <path d="M7 17 C4 21 4 25 8 28" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <path d="M12 17 C11 21 10 25 13 28" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <path d="M20 17 C21 21 22 25 19 28" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <path d="M25 17 C28 21 28 25 24 28" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <circle cx="13" cy="11" r="1.5" fill="currentColor"/>
  <circle cx="19" cy="11" r="1.5" fill="currentColor"/>
  <!-- Wordmark: "slipway" -->
  <text
    x="36"
    y="22"
    font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    font-size="18"
    font-weight="600"
    fill="currentColor"
  >slipway</text>
</svg></a>
          </div>
        </dialog>
      `
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
module.exports = widgetShell
