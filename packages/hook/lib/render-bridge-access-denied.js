module.exports = function renderBridgeAccessDenied({
  message,
  retryPath,
  homePath
}) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light dark">
    <title>Bridge access unavailable | Slipway</title>
    <style>
      :root {
        color-scheme: light dark;
        --brand: #0284c7;
        --canvas: #ffffff;
        --ink: #111827;
        --muted: #6b7280;
        --line: #e5e7eb;
        --soft: #f9fafb;
        --button: #111827;
        --button-ink: #ffffff;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      * { box-sizing: border-box; }
      body {
        min-height: 100vh;
        margin: 0;
        display: grid;
        place-items: center;
        background: var(--canvas);
        color: var(--ink);
      }
      main {
        width: min(32rem, calc(100% - 2rem));
        padding: 3rem 0;
      }
      .brand {
        display: flex;
        align-items: center;
        gap: .875rem;
        color: var(--ink);
      }
      .brand svg { width: 3rem; height: 3rem; color: var(--brand); flex: none; }
      .brand-name { display: block; font-size: 1.25rem; font-weight: 700; letter-spacing: -.025em; }
      .product-name {
        display: block;
        margin-top: .15rem;
        color: var(--muted);
        font: 600 .7rem/1.2 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        letter-spacing: .14em;
      }
      .status {
        display: flex;
        align-items: center;
        gap: .625rem;
        margin: 2.25rem 0 1.5rem;
        padding-top: 1.5rem;
        border-top: 1px dashed var(--line);
        color: var(--muted);
        font: 600 .72rem/1.4 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        letter-spacing: .08em;
      }
      .status-dot { width: .55rem; height: .55rem; border-radius: 999px; background: var(--brand); }
      h1 { margin: 0; max-width: 12ch; font-size: clamp(2rem, 8vw, 3.25rem); line-height: 1.02; letter-spacing: -.055em; }
      .message { margin: 1.25rem 0 0; max-width: 43ch; color: var(--muted); font-size: 1rem; line-height: 1.65; }
      .context {
        margin-top: 1.75rem;
        padding: 1rem 1.125rem;
        border-left: 3px solid var(--brand);
        background: var(--soft);
        color: var(--muted);
        font-size: .875rem;
        line-height: 1.55;
      }
      .context strong { color: var(--ink); font-weight: 650; }
      nav { margin-top: 2rem; }
      nav ul { display: flex; flex-wrap: wrap; gap: .75rem; margin: 0; padding: 0; list-style: none; }
      a {
        min-height: 2.75rem;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: .7rem 1rem;
        border-radius: .375rem;
        color: var(--ink);
        font-size: .875rem;
        font-weight: 700;
        text-decoration: none;
      }
      a.primary { background: var(--button); color: var(--button-ink); }
      a.secondary { outline: 1px solid var(--line); outline-offset: -1px; }
      a:hover { text-decoration: underline; text-underline-offset: .2rem; }
      a:focus-visible { outline: 3px solid var(--brand); outline-offset: 3px; }
      footer {
        margin-top: 2.5rem;
        padding-top: 1rem;
        border-top: 1px dashed var(--line);
        color: var(--muted);
        font: .68rem/1.5 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        letter-spacing: .06em;
      }
      @media (max-width: 30rem) {
        main { padding: 2rem 0; }
        nav li, nav a { width: 100%; }
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --canvas: #000000;
          --ink: #f9fafb;
          --muted: #9ca3af;
          --line: #374151;
          --soft: #0b0f14;
          --button: #f9fafb;
          --button-ink: #111827;
        }
        .brand svg { color: #ffffff; }
      }
    </style>
  </head>
  <body>
    <main>
      <header class="brand" aria-label="Slipway Bridge">
        <svg aria-hidden="true" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M7 17 C7 3 25 3 25 17 Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M7 17 C4 21 4 25 8 28" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <path d="M12 17 C11 21 10 25 13 28" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <path d="M20 17 C21 21 22 25 19 28" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <path d="M25 17 C28 21 28 25 24 28" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <circle cx="13" cy="11" r="1.5" fill="currentColor"/>
          <circle cx="19" cy="11" r="1.5" fill="currentColor"/>
        </svg>
        <span>
          <span class="brand-name">Slipway</span>
          <span class="product-name">BRIDGE</span>
        </span>
      </header>

      <section aria-labelledby="access-heading">
        <p class="status"><span class="status-dot" aria-hidden="true"></span>403 · BRIDGE_ACCESS_DENIED</p>
        <h1 id="access-heading">Bridge access unavailable</h1>
        <p class="message">${escapeHtml(message)}</p>
        <p class="context"><strong>Bridge is Slipway’s admin view for this app.</strong> Try again after your access or verified email has been updated.</p>
        <nav aria-label="Bridge access actions">
          <ul>
            <li><a class="primary" href="${escapeHtml(
              retryPath
            )}">Try Bridge again</a></li>
            <li><a class="secondary" href="${escapeHtml(
              homePath
            )}">Return to app</a></li>
          </ul>
        </nav>
      </section>

      <footer>SECURED AND SERVED BY SLIPWAY</footer>
    </main>
  </body>
</html>`
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
