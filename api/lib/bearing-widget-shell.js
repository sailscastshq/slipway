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
