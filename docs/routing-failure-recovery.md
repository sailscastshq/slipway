# Applying routing settings

Environment domain changes stage a route candidate before saving the requested
settings. Caddy must render the expected hostname as well as the expected
upstreams and accept the generated configuration. Cutover failures restore the
previous saved values and invoke route rollback; API callers receive 503 instead
of a success message.

Dashboard domain and TLS-email changes use the same staged route lifecycle. The
working dashboard route remains present while the candidate is checked. A failed
save leaves the entered values in the form and offers Retry apply. If rollback
also fails, the error explicitly asks the operator to inspect Caddy.

Verification proves that Caddy accepted routing configuration. It does not prove
that public DNS has propagated or that external clients can reach the server.
Those broader custom-domain readiness checks remain tracked separately in #374.

Inertia validation responses explicitly send HTTP 303 and Location. This prevents
real browsers from repeating a failed PATCH against the referring page, while
remaining compatible with the virtual request test adapter.
