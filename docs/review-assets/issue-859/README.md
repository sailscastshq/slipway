# Shared updater browser evidence

Captured from Sounding's real Slipway settings page and native account-menu update modal using an isolated test world. Transport responses simulate a durable migration preflight operation and SSE failure/drop; these are UI evidence, not production upgrade evidence. The displayed 0.0.122 is a fixture target, not a published release.

- `modal-desktop.png`: existing desktop account-menu entry, stream drop and durable status recovery.
- `modal-mobile.png`: responsive modal while the same operation remains active.
- `settings-mobile.png`: settings page still in preflight after eighty seconds, without a false rollback.

The original untouched 0.0.121 modal produced “likely rolled back” while a healthy old-version response was still expected. The corresponding regression now stays in progress and follows the engine's verified outcome. The mobile account-menu opening and dismissal paths are also exercised by `tests/e2e/pages/settings/update-engine.test.js`.
