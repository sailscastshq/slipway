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
