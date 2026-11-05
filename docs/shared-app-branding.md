# Shared app branding: ownership and Bridge diagnosis

## Existing ownership

Appearance is already app-scoped, not owned by a Bearing space. The canonical
editor is `/projects/:slug/environments/:envSlug/apps/:appSlug/appearance`, linked
from the app's Settings. `app-appearance:v1:<app id>` stores its validated profile
in Setting. Bearing public pages/widgets and host-origin Bridge consumed it
before Beacon; Beacon now reads the same profile. Saving through any link affects
all those surfaces for that app. Ordinary Slipway control-panel Bridge receives
`appearance: null` and keeps Slipway's own design.

The editor still offers Bearing-specific widget/public feedback previews. Its
authorization helper also delegates to `bearing.resolveManager`, although that
resolver checks app/team ownership and does not require a Bearing space. These
are presentation/module coupling, rather than separate ownership of the data.

## Reproduced locally

This diagnosis uses server-issued host Bridge launch credentials and fixture
records, with the same forwarded-host and route rewrite as the app-domain
surface. It is not a reproduction against a production URL; the affected hosted
URL is still needed to confirm which defects explain that instance.

1. Sails normally skips session handling for asset-looking paths. The protected
   internal Bridge `_/appearance.css` route therefore returned 401 despite a
   valid host Bridge session. Its CSS variables were missing while generic
   `.app-appearance` rules still applied. The narrow session exception in
   `config/session.js` keeps authentication for this dynamic stylesheet; guest
   and revoked sessions still receive 401. Static assets keep the normal fast
   path.
2. With that stylesheet available, a fixed dark app and light OS produced white
   table/menu hover backgrounds with white text (1:1). Partition fills also
   followed OS utilities instead of the app palette (about 1.18:1 against the
   track). The inverse mode disagreed too. Neutral hover/focus and switch states
   now use semantic app colours, and partition fills use the resolved text
   colour. The default fixture's hover and chart contrast is 16.44:1 in light
   mode and 17.18:1 in dark mode, each tested against the opposite OS mode.
3. Teleported action/collection dialogs and the sibling media preview sat outside
   the workspace appearance wrapper. They now receive the host-origin profile
   themselves. Control-panel dialogs continue with no app profile.

These fixes address demonstrated paths; they do not claim a complete audit of
every Bridge editor or an independent live monitoring service. Regression checks
cover authenticated CSS, tables, action menus/dialogs, keyboard focus, switches,
partition charts, media error dialogs and revoked access in both fixed modes.
Existing functional media tests also cover authenticated video/PDF previews.

## Proposed neutral home (not a migration)

Keep the existing app Settings route and record key so bookmarks, APIs and saved
profiles remain compatible. Present the page as **Branding & appearance**, with
shared identity/logo and semantic colour controls, and explicit previews for
Bridge, Bearing and Beacon. Explain that saving changes every enabled app
surface. Move authorization into a neutral app-settings resolver, preserving
the same owner/admin and hierarchy checks; keep a compatibility forwarding
helper for callers during that refactor.

Use one shared profile by default. Operational success/danger colours retain
their meaning, and Bridge's administration layout should not be redesigned by
a branding control. If real use demonstrates a need for surface-specific
typography/density or palette choices, add bounded per-surface overrides as
deltas, rather than copying three independent profiles. Resolve each delta on
top of the shared validated profile. Keep v1 fallback reads and existing
profiles unchanged until an explicit save; any future version conversion must
be idempotent and preserve logos and palettes. Do not reset or migrate production
data merely to relocate the settings UI.

No settings relocation, production migration, deployment or release was made
as part of this diagnosis.
