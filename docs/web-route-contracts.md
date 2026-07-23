# Web route contracts

Slipway keeps browser navigation and reusable APIs as separate contracts.

## Inertia pages

Browser `GET` routes that own a Vue page return an Inertia response. Their
controller uses `responseType: 'inertia'` and returns the page component and its
props. Page-owned data belongs in those props instead of a second browser JSON
request.

## Inertia actions

Browser-only mutations use Inertia forms or router visits. Their controllers
redirect after success, flash user-facing confirmation, and return validation
problems through the `badRequest` response. They do not return JSON payloads.

Use `inertiaRedirect` when a changed shared prop must be refreshed or a full
navigation is required. Use a regular redirect for actions that can preserve the
current Inertia page state.

Examples include switching teams, updating a team logo, testing a notification
channel, and starting a backup restore.

## JSON APIs and transports

JSON belongs under `/api/v1` when the endpoint is reusable outside a single
page, is an operational command, or must return an immediate machine-readable
result. This includes application and service lifecycle commands, Dock, Helm,
Bosun, CLI authentication, polling, and the Content Manager image-upload
transport.

Streams, health checks, downloads, webhooks, and telemetry retain their
specialized response contracts. Moving a route under `/api/v1` does not weaken
its existing authentication, authorization, CSRF, or ownership checks.

## Rule of thumb

If the browser submits something and then shows a Slipway page, use Inertia. If
the caller needs a reusable payload or transport response, use `/api/v1`. A
non-API browser route should never accidentally return JSON.
