# Deployment startup readiness (#770)

A new deployment or rollback waits up to 120 seconds for a 2xx HTTP response
from the configured health path. App Settings accepts a startup window of
5–600 whole seconds. The app override is stored with resource limits; changing
only this window does not update the running container. Older clients preserve
an existing override. Instance defaults use `deploymentStartupTimeoutSeconds`
in `config/custom.js`. Invalid windows fail rather than allowing an unbounded wait.

Readiness uses a monotonic deadline. Each HTTP request and fresh Docker state
inspection is limited by the remaining time, with at most five seconds per
probe. HTTP requests have a total timer as well as a socket inactivity timeout.
A candidate that exits, dies, disappears, or restarts fails immediately; a
running candidate that never listens receives PORT and health-path guidance.
Inspection failure cannot certify container health but still permits a successful
HTTP readiness response. Polling reports progress approximately every 15 seconds.
Cancellation aborts probes and the waiting interval. Normal traffic cutover,
serving-container preservation and cleanup remain governed by existing flow.

Before a failed candidate is removed, capture fresh state (including exit code
and OOM status) and the last 100 timestamped lines from both stdout and stderr.
Each diagnostic command has a five-second limit and a 64 KiB bound per output
channel. Partial output is retained with an incomplete marker. Output passes
through the shared secret redactor and deployment-log persistence. Runtime
configuration is registered conservatively; no plaintext configuration map is
written to logs. Diagnostic capture cannot replace the original failure.

A longer window only accommodates slow startup. It does not fix application
crashes, schema mismatch, missing settings, or wrong ports, and this change does
not establish the cause of any earlier production deployment failure.

Tests use a simulated clock and synthetic process output. They perform no
Docker or production operations. Screenshots are explicitly synthetic UI
fixtures, not evidence of a production rollout.
