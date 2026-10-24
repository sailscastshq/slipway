# Dashboard protocol implementations

Slipway and `sails-hook-slipway` are independently packaged. The hook writes
versioned Helm runtime metadata and sends Wake payloads; Slipway consumes and
validates those values. These modules implement the dashboard side of the v1
contract without loading source files from the hook package at runtime.

Keep their observable behavior compatible with the published hook. The
runtime-contract unit trial exercises both implementations against the same
fixtures before either side changes its contract behavior.

Quest diagnostic redaction also has independent dashboard and hook copies.
The Quest diagnostic contract test keeps byte/whitespace/redaction behavior
in parity, and the Docker smoke test loads the ledger without hook source.

Quest metadata and safe JSON projections also have independent dashboard and hook
copies. The instance workspace unit trial checks parity and loads the adapter
with hook source explicitly unavailable. Neither copy creates a scheduler.

CI has independent dashboard and CLI protocol implementations as well. The dashboard records the reviewed executor digest rather than importing CLI files, which production images intentionally exclude. The CI packaging trial compares canonical policy/statement behavior and the executor digest, then loads all CI helpers with package imports blocked. Update the reviewed digest only together with matching CLI/server changes.
