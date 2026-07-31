# Slipway 0.0.52

Slipway 0.0.52 is the largest production-hardening release since Slipway was
introduced. It turns Bridge into a configurable Sails-native application
backend, rebuilds Helm into a safer production workspace, makes deployments
recoverable under interruption, adds deployment-native secrets and release
flags, and closes dozens of smaller correctness gaps across Dock, Lookout,
Content Manager, validation, ingress, and the operator experience.

The release contains more than 50 merged pull requests and closes more than 50
tracked issues. The important change is not the count. It is that the paths
between source, build, traffic, data, observation, and rollback are now much
more explicit and much harder to leave in an ambiguous state.

## Read this before upgrading

### Node.js 22 is now required

Slipway, its CLI, and `sails-hook-slipway` now require Node.js 22 or newer. The
Docker image already contains the supported runtime. Install Node.js 22 before
using the CLI or the hook directly on another host. This aligns development,
CI, production configuration, and documentation around one tested baseline
(#239, #210).

### Existing installations: harden the public port boundary

Fresh installations need no migration. They expose Caddy on ports 80 and 443,
while the Slipway dashboard and allocated application ports bind to
`127.0.0.1` by default.

Existing installations deliberately retain their previous public bindings on
the first update. Slipway does this so a security update cannot silently break
an operator who still relies on a raw `SERVER_IP:PORT` URL. To opt into the new
private boundary, first record the current state:

```bash
sudo docker ps --format 'table {{.Names}}\t{{.Ports}}'
sudo ss -lntp
sudo ufw status || true
sudo firewall-cmd --list-ports || true
```

Also record the inbound rules in your VPS provider firewall. Do not share
values from `/etc/slipway/.env` in an issue or support conversation.

Then rerun the installer with private dashboard and application bindings:

```bash
curl -fsSL https://raw.githubusercontent.com/sailscastshq/slipway/main/install.sh -o /tmp/install-slipway.sh
sudo env \
  SLIPWAY_DASHBOARD_HOST=127.0.0.1 \
  SLIPWAY_APP_PORT_HOST=127.0.0.1 \
  bash /tmp/install-slipway.sh
```

Redeploy every public application. Existing containers keep their previous
Docker binding until Slipway replaces them. Before closing ports, verify:

- the Slipway dashboard domain loads through Caddy;
- `slipway whoami` succeeds;
- every application domain loads;
- webhooks and realtime/SSE flows still work where used;
- `docker ps` shows `127.0.0.1:1337` for the dashboard;
- redeployed apps show `127.0.0.1:13xx` bindings;
- local health checks work from the server; and
- external raw `SERVER_IP:13xx` requests fail as expected.

After verification, remove inbound port 1337 and the 1338–1500 range from the
VPS provider firewall. The installer aligns active UFW or firewalld rules, but
it cannot edit provider firewalls or SSH policy (#202, #241).

If you must restore raw IP access, roll back the binding explicitly:

```bash
sudo env \
  SLIPWAY_DASHBOARD_HOST=0.0.0.0 \
  SLIPWAY_APP_PORT_HOST=0.0.0.0 \
  bash /tmp/install-slipway.sh
```

Redeploy the affected apps and reopen only the ports you still require. You can
make only application ports public with `SLIPWAY_APP_PORT_HOST=0.0.0.0` while
leaving the dashboard behind Caddy.

Read the complete [Ingress and Firewall](https://docs.sailscasts.com/slipway/ingress-and-firewall)
guide for the default VPS, explicit direct-access, and optional Cloudflare
Tunnel modes.

### Upgrade the Slipway hook where it is installed

Applications using Lookout, app-local Bridge, or release flags should install
the matching hook release and deploy once:

```bash
npm install sails-hook-slipway@0.0.4
```

Bridge and release flags receive private app-scoped credentials during that
deployment. Later release-flag changes do not require another deploy.

## Bridge is now an application backend

Bridge began as useful Waterline introspection. In 0.0.52 it becomes a
production-grade, configurable operational and content-management layer for a
Sails application.

- **Resource contracts.** `config/slipway.js` can define labels, list/show/form
  fields, sorting, search, actions, rich Markdown fields, and deliberately
  hidden resources. Safe Waterline discovery remains the zero-configuration
  default (#216, PR #277).
- **Opaque identifiers.** Numeric, string, and UUID primary keys now survive
  every record and relationship path without coercion. Apps can use their own
  helper to generate required identifiers (#217, PR #278).
- **Authorization at the target app.** Field visibility and view, create,
  update, delete, bulk-delete, and custom-action decisions can be resolved by a
  Sails helper inside the application. Sensitive attributes are hidden by
  default and forged hidden fields are rejected before execution (#218,
  PR #279).
- **Typed forms.** Bridge understands text, booleans, enums, money, JSON,
  dates, URLs, Markdown, relationships, images, files, and protected values.
  Create actions remain disabled until required fields are valid (#219,
  PR #280).
- **Managed uploads.** R2 and S3 uploads stream through app-, environment-, or
  instance-scoped credentials. Bridge stores only the canonical public URL in
  the Waterline record and protects the mutation with a short-lived signed
  receipt (#219, #225; PRs #280 and #287).
- **Reusable storage layouts.** Upload path templates can reference authorized
  fields and relationships, so course, chapter, lesson, thumbnail, and video
  hierarchies are application configuration rather than Slipway hardcoding.
  Existing conventional `R2_` or `S3_` credentials can be reused (#225,
  PR #287).
- **Waterline relationships.** Belongs-to selectors are bounded and
  searchable. Collection attach/detach is an explicit opt-in and never deletes
  related records (#220, PR #281).
- **Custom actions.** Resource, record, and bulk actions call ordinary target
  app helpers, reuse typed fields, and repeat authorization at execution time
  (#221, PR #282).
- **Dashboards.** App and resource dashboards can expose metrics, trends,
  partitions, recent records, custom helper values, and quick actions. A broken
  card fails independently instead of taking down the page (#222, PR #283).
- **Secure app-local access.** An application can expose `/bridge` to verified
  host-app users through invitations and viewer, editor, or administrator
  grants. Single-use launch codes, dedicated sessions, revocation, audit
  history, and app-scoped credential rotation keep Slipway access separate
  from the app's own identity system (#223, PR #284).
- **Filters and lenses.** Bridge now has type-aware allowlisted filters and
  shareable saved views with fixed filters, columns, sorting, and optional
  custom helpers (#224, PR #285).
- **Markdown without editor lock-in.** Tiptap provides a minimal visual writing
  surface, Markdown shortcuts, contextual formatting, and inline image upload,
  while ordinary Markdown remains the stored value. Raw HTML is denied by
  default (#216, #219, #225).

The result is closer to a Sails-native Laravel Nova than a generic database
viewer: the application owns its models and authorization, while Slipway owns
the reusable operational interface.

Read the complete [Bridge guide](https://docs.sailscasts.com/slipway/bridge).

## Helm is now a production workspace

Helm still lets you run Sails code inside the selected application. The
difference is that it now treats production execution as a bounded,
observable, reversible operator workflow instead of a large textarea and an
unstructured return value.

- Project Helm and Bosun share one parser-backed runtime for declarations,
  expressions, statements, async work, console output, and timeout behavior
  (#267, PR #288).
- Run only the current selection while preserving its real line and column, or
  run the full document when nothing is selected (#268, PR #289).
- View compatible results as a table, JSON tree, or raw value. Console output
  stays separate and bounded, CSV export is scoped to compatible results, and
  returned HTML remains inert (#269, PR #290).
- Syntax and runtime errors appear on the exact CodeMirror token that caused
  them, while complete stacks remain available on demand (#270, PR #291).
- Stop an active execution. Slipway terminates the isolated process, keeps
  bounded partial output, ignores late responses, and reports success, error,
  timeout, or cancellation with timing and size metadata (#271, PR #292).
- Complete live Sails model names, attributes, helpers, configuration paths,
  Waterline methods, and query modifiers without sending configuration values
  or records to the browser (#272, PR #294).
- Keep private, source-only execution history and reusable personal or project
  snippets with explicit retention and ownership (#273, PR #296).
- Arm likely production writes for a short, single-use window bound to the
  exact actor, source, app, container, and deployment. Audits remain
  privacy-safe (#274, PR #297).
- Add `// @inspect` for bounded inline values and `// @trace queries` for
  redacted Waterline/native query traces without rewriting snippets to add
  temporary logs (#275, PR #300).
- Maintain named scratchpads with independent source, target, and result-view
  state. A confirmation protects production target changes, and returned data
  is not persisted (#276, PR #301).
- Oversized output now scrolls inside its own pane instead of replacing the
  editor, and long team names truncate without changing the existing minimal
  layout (#229, PR #247).

All editor-backed surfaces now use a shared CodeMirror component rather than
transparent textarea/highlighting overlays. That gives Dock, Bosun, Helm, and
environment configuration real selection, undo history, indentation,
accessibility, wrapping, keyboard submission, and system light/dark theming
(#212, PR #264).

Read the complete [Helm guide](https://docs.sailscasts.com/slipway/helm).

## Deployments now fail and recover deliberately

The deployment pipeline received the deepest reliability work in this
release.

- CLI-pushed projects can be redeployed from the web using their persisted
  source snapshot. Missing source is rejected before creating misleading
  history, and preflight failures remain visible without stream logs (#230,
  #242; PR #244).
- Deployment history remains visually compact while ordering active work,
  current releases, and chronological history correctly across legacy and
  current records (#240, PR #245).
- Direct app URLs are advertised only after verifying the actual Docker port
  mapping. Installer, updater, port range, and host firewall behavior now agree
  (#241, PR #246).
- Docker is the source of truth for lifecycle reconciliation, so an app that
  Docker automatically recovers returns from Stopped to Running in Slipway
  without corrupting transitional deployment states (#228, PR #248).
- Caddy cutover is transactional. Slipway stages and verifies a candidate
  route while the old route remains live, commits app state before retiring the
  previous release, and restores both route and state if promotion fails
  (#232, PR #249).
- Deployments and rollbacks are serialized per app through durable queues and
  renewable fenced leases. Startup and the Quest watchdog recover interrupted
  builds, containers, ports, images, and cutovers (#233, PR #250).
- Cancellation is now a real process signal, not a database label. It stops Git
  sync, Docker build, startup, and health checking before cutover; removes the
  candidate; preserves the live release; and lets the next queued deployment
  proceed (#231, PR #254).
- CLI deployments without Git branch or commit metadata now reach their
  uploaded build context instead of failing Sails helper validation (#303,
  PR #304).
- Signed pull-request and branch-delete webhooks are acknowledged without
  inventing preview environments. New and repaired GitHub hooks subscribe only
  to pushes (#298, PR #302).
- Custom domains, generated domains, and verified direct URLs now follow one
  canonical precedence everywhere—including the app page, command palette,
  logs, rollback output, and worker messages (#211, PR #263).
- Browser favicons reflect building/running work and briefly report success,
  failure, or cancellation before returning to idle when seen or timed out
  (#214, PR #266).
- The production asset pipeline now uses the current Boring Stack Inertia v3
  and Shipwright path and excludes host `node_modules` from Linux Docker build
  contexts, eliminating the browser `process is not defined` failure class.

Read [How deployments work](https://docs.sailscasts.com/slipway/how-deployments-work)
for the complete queue, health-check, cutover, cancellation, and recovery
model.

## Safer data and infrastructure operations

- Backups, restores, S3/R2 transfers, and Dock imports stream with
  backpressure instead of buffering entire payloads in Slipway memory. Size,
  disk reserve, timeout, cancellation, stdout, and stderr limits are bounded,
  and destructive restores require a verified safety snapshot (#234,
  PR #251).
- Project, environment, app, service, and legacy preview cleanup now runs
  through one durable, resumable, idempotent operation. Traffic and active work
  stop before containers, ports, records, and optional retained artifacts are
  removed (#236, PR #260).
- PostgreSQL, MySQL, Redis, and MongoDB use tested version lines and immutable
  image references. Legacy `latest` services preserve their exact image and
  volume; supported adjacent major upgrades use backup, fresh-volume restore,
  readiness verification, cutover, and recovery (#238, PR #257).
- Lookout collection no longer gates retention or disk-health work on Docker
  availability. Telemetry moves into the observability datastore with a
  restart-safe migration, bounded retention, query-shaped indexes, and visible
  collector/retention health (#237, PR #259).
- Environment values can safely reference `$VAR` or `${VAR}`, including the
  authoritative allocated `PORT`, without invoking a shell. Cycles, unknown
  values, excessive expansion, and literal dollars are bounded, while Docker
  errors redact environment values and build arguments (#226, PR #262).

## Deployment-native secrets

Slipway now encrypts app-scoped configuration instead of treating every
runtime value as a broadly inherited environment setting (#200, PR #312).

- Values remain write-only; the UI and audit log receive safe metadata.
- Global, environment, app, and platform configuration resolve through one
  precedence path.
- Managed credentials cannot be casually overwritten by ordinary edits.
- Every deployment records a keyed configuration fingerprint and a value-free
  manifest, making config-only changes distinguishable without leaking values.
- Environment-copy policies can inherit, omit, or randomize specific values.
- Bridge storage and access credentials retain explicit scope precedence.

Read [Secrets](https://docs.sailscasts.com/slipway/secrets) and
[Environment variables](https://docs.sailscasts.com/slipway/environment-variables).

## Release flags complete the Lookout loop

Slipway can now deploy code before releasing behavior (#227, PR #313).

```js
const useNewCheckout = await sails.helpers.flags.enabled.with({
  key: 'new-checkout',
  req: this.req,
  defaultValue: false
})
```

Flags are scoped to one app and environment. The first release supports an
audited master kill switch, typed user/account/tenant/team allowlists, and
deterministic 0–100% cohorts. `sails-hook-slipway` caches the private contract,
refreshes in the background, and uses the last valid snapshot or explicit
default when the control plane is unavailable.

The useful unit is not only the switch. Lookout compares flag-on and flag-off
request count, latency, 5xx rate, and trace-linked exceptions. A team can
release to itself, expand gradually, observe whether the new path is healthier,
and kill it without rebuilding or redeploying.

Read [Release Flags](https://docs.sailscasts.com/slipway/release-flags).

## Content Manager and Dock

- Content Manager now commits create, update, and delete operations to the
  connected GitHub repository using Conventional Commits and optimistic blob
  SHAs. Save & Deploy builds the exact content commit, while duplicate webhook
  deployments are suppressed (#235, PR #252).
- The Markdown textarea and permanent split preview have been replaced with a
  minimal Tiptap visual editor. Markdown remains canonical; unsupported syntax
  stays safely in source mode; pasted HTML and unsafe URLs are sanitized; and
  provider-backed images upload directly into portable Markdown (#253,
  PR #255).
- Dock preserves every PostgreSQL/MySQL statement result, identifies partial
  failures without discarding earlier successes, and scopes copy/export to the
  selected result (#213, PR #265).
- Command-only and mixed SQL output now use compact ordered summaries instead
  of occupying the result area with repeated command text (#293, PR #295).

## Correct web contracts and calmer validation

- Browser actions now use proper Inertia redirects, flash messages, and
  validation errors instead of ad-hoc JSON responses. Immediate-result uploads
  live under `/api/v1`, and Inertia location responses work for every HTTP
  method (#243, PR #256).
- Setup, login, password recovery, password reset, and profile forms validate
  against server-owned rules before submission without consuming rate limits,
  sending email, mutating accounts, or revealing whether an account exists
  (#205, PR #306).
- Project, environment, app, and service forms validate before database,
  Docker, Caddy, webhook, audit, or restart work. Stable environment URLs no
  longer change when display names change (#206, PR #307).
- Instance, Git, environment, notification, upload, team, and token settings
  share the same field-scoped validation and keep stored credentials out of
  Inertia validation payloads (#207, PR #308).
- Bridge and Content Manager validate target-model fields, slugs, metadata,
  Markdown, and JSON before mutation without losing local edits (#208,
  PR #309).
- Slipway-owned, responsive light/dark 404 and 500 pages replace the default
  Sails views. Production failures remain generic, and Inertia errors fall back
  safely (#204, PR #305).

## Testing, runtime, and maintenance

- All Slipway unit, functional, Inertia, and browser trials now run through the
  public Sounding 0.2 API. Controller imports, private testing internals,
  hand-built CSRF sessions, and mixed runners were removed (#242, PR #244).
- CI and release workflows use current Node 24-based GitHub Actions while the
  application runtime remains Node.js 22 (#210, PR #261).
- README links, generated production configuration, CLI runtime checks, and
  docs/runtime consistency now have automated regression gates (#239,
  PR #258).

## Upgrade checklist

1. Read the ingress migration above and capture the existing server boundary.
2. Update Slipway through Bosun or rerun the installer.
3. If upgrading an older installation, opt into loopback bindings, redeploy
   apps, verify domains/CLI/webhooks/realtime, then close old provider ports.
4. Upgrade apps that use Slipway integration:

   ```bash
   npm install sails-hook-slipway@0.0.4
   ```

5. Deploy those applications once to receive current app-scoped Bridge,
   Lookout, and release-flag credentials.
6. Verify database services before choosing any offered major-version upgrade.
7. Review the new secret scopes and convert broadly inherited credentials to
   app scope where appropriate.

## Full changelog

Every item above was exercised through Sounding unit, functional, or real
browser trials. UI work was reviewed in light and dark mode, and the deployment,
cutover, backup, installer, and service paths include focused failure and
recovery coverage.

**Full changelog:** https://github.com/sailscastshq/slipway/compare/v0.0.51...v0.0.52
