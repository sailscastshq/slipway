# Bearing recovery review screenshots

Captured from draft PR #645 code head `f06588f5cb14386f3f2da427e9803657666c499d`, using the disposable configured-slipway browser fixture. All displayed content and identities are synthetic test data. The capture trial passed; product code was unchanged.

- `reload-recovery.png`: the tab-local restore/discard prompt after reload, before restoring.
- `leave-confirmation.png`: navigation asks to keep editing or explicitly discard the recovered unsaved update.
- `newer-edits-kept-mobile.png`: at 375px width, the completed save reports that newer title, summary and body edits remain unsaved on the same draft.

These are current fixed UI states, not fabricated before/after comparisons. The original recovery regression verifies database persistence, repeated-save protection, publishing, cancel/discard, expiry and storage failure beyond what still images can demonstrate.
