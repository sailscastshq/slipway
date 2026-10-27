# App appearance

An app administrator can make Bearing feel like the host product without editing CSS. One app-scoped appearance supplies the display name, logos, light and dark palettes, typography, corners and density. It applies to the Bearing launcher, widget chrome, feedback board and detail, roadmap, updates and update permalinks. Host Bridge starts with the same identity, accent and surfaces; its operational status and destructive colours retain their meaning. Slipway administration keeps its own appearance.

## Configure and preview

1. Open the app's **Settings → Appearance**, or **Bearing → Settings → App appearance**. Only the app team's owners and administrators can edit it.
2. Set the display name and upload a light logo. A dark variant is optional. PNG, JPEG and still WebP are supported, up to 256 KB and 4096 × 4096 pixels. Slipway decodes and re-encodes logos as WebP, strips metadata, and serves managed app-scoped images. A single logo uses a white backing in either mode. SVG, animated images, external image URLs and custom CSS are not accepted.
3. Edit the light and dark palettes. Background, surface, text, secondary text, border, accent, on-accent text and focus are semantic colours. Saving requires 4.5:1 text contrast on the relevant background/surface/accent and 3:1 focus contrast. Warning, success and danger colours are separate.
4. Choose **Follow app**, **Follow system**, **Always light** or **Always dark**. Follow app accepts the host's explicit `data-theme="light|dark"`, `data-color-scheme="light|dark"`, or `light`/`dark` root class. Configure its fallback for a host without a signal. Standalone pages and Bridge use the saved fallback. System follows the visitor's device preference.
5. Switch the live draft preview between widget and public pages, feedback/roadmap/updates, light/dark and mobile/desktop. The widget uses the same shell markup and stylesheet as production, including its floating launcher, panel dimensions and mobile layout. Open, close, press Escape and use its surface navigation; the actual Bearing page components render inert example content inside the panel. Public-page previews remain isolated too. Draft colours and logo choices do not write app configuration or change live pages.
6. **Save appearance** applies the draft immediately to new page loads and new widget bootstraps. A redeploy is not needed for subsequent branding changes. Already-open widgets keep their fetched appearance until the host reloads.

**Reset to defaults** stages the documented Slipway palette, system mode, system typography, soft corners, comfortable density, project display name and no logos. Preview it, then save to apply. Leaving without saving preserves the saved appearance. The reset API (`PATCH` with `{ "reset": true }`) removes the app override entirely.

The preview shows representative content; it does not submit feedback, make votes or navigate to live pages. Bridge's initial shared branding is not a complete restyling of every editor/table/dialog.

## Rendering and compatibility

The version 1 contract accepts only bounded names, enumerated presets and six-digit hex colour values. The approved fonts are platform system sans, Georgia and system monospace; there are no downloaded fonts or arbitrary font URLs. Invalid or missing stored tokens use defaults, and a stored palette that fails contrast falls back to the default palette. Apps without an override retain their existing Bearing appearance and project-name fallback.

Appearance is persisted under `app-appearance:v1:<app id>` in Slipway's existing settings storage, avoiding a release-schema migration. Every settings/logo mutation resolves the selected app within its environment, project and team. Public config contains only the resolved public contract and managed logo paths, never raw logo bytes or host credentials. Reset and app deletion remove the scoped record.

The existing same-origin Caddy model remains. Bearing's reserved `feedback/_/appearance.css`, `feedback/_/appearance/logo/*` and `feedback/_/widget.css` assets travel through the existing feedback wildcard proxy. Existing app routes continue working without a route refresh or redeploy. The published host hook's existing Bearing bootstrap/open API remains compatible; no hook or npm release is required for this server feature.

Widget styles now load as same-origin external stylesheets instead of an injected inline style element. Host CSP should allow the bootstrap and assets with `script-src 'self'`, `connect-src 'self'`, `frame-src 'self'`, `style-src 'self'` and `img-src 'self'`. No extra external image/font origin or `unsafe-inline` allowance is needed for the branding. Existing Slipway/Inertia bootstrapping and unrelated component styles retain their pre-existing CSP requirements; this feature does not rewrite the platform's complete CSP contract. The settings draft preview uses local image data and scoped style attributes inside its own preview, so an operator-supplied dashboard CSP must permit those preview capabilities.

For Follow app, the bootstrap resolves the initial mode before assigning the iframe URL. Runtime messages contain only `{type:'slipway:appearance',version:1,mode:'light|dark'}`. The receiver checks exact parent window, same origin, version, type, mode and allowed keys. It ignores other sources and style payloads. The bootstrap uses an exact target origin and only its expected same-origin frame.

## Acceptance checks

- Saved name and managed logos appear across widget and public surfaces; dark logo falls back safely.
- Draft preview and reset do not change a saved app before Save; save and reload retain the configuration.
- Light, dark, system and host modes agree across widget chrome and iframe; standalone pages use the saved fallback.
- Different apps and teams retain separate branding; members cannot edit it.
- Unsafe logo/style/font payloads and insufficient text/focus contrast are rejected.
- Widget open, close, Escape, focus return and surface navigation remain usable on desktop and mobile.
- Public detail, composer, filters, updates and empty states retain readable semantic colours and layouts.
