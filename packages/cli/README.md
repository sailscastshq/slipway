# slipway

> The CLI for Slipway - the Sails-native deployment platform

## Zero Dependencies

This CLI has **no npm dependencies**. It uses only Node.js 22+ built-ins:

- `node:util` → `parseArgs` for argument parsing
- `node:readline` → interactive prompts
- `node:fs` → config storage in `~/.slipway/`
- Native `fetch` → HTTP requests
- Native `WebSocket` → log streaming, Helm REPL

The CLI starts without installing third-party runtime dependencies.

## Commands

```bash
# Slide into production!
slipway slide                    # Primary command
slipway deploy                   # Alias
slipway launch                   # Alias

# Project context
slipway init
slipway link my-project

# Databases
slipway db:create main-db --type=postgresql
slipway db:url main-db
slipway services
slipway backup:create main-db

# One custom domain per environment (run in a linked project)
slipway environment:update production --domain app.example.com
slipway environment:update production --domain ""  # Remove custom domain
slipway environments

# Environment variables
slipway env:set KEY=value --env production
slipway env --env production

# Operations
slipway terminal --env production
slipway logs --env production --follow
```

## Custom domains

A custom hostname belongs to an environment and is shared by its routed apps.
Setting another hostname replaces the previous custom hostname. A generated
hostname, when configured, remains available as a fallback.

Point DNS to your Slipway server before saving. A verified proxy route does not
prove DNS propagation or certificate issuance. HTTPS becomes available after
DNS and public ingress allow automatic certificate provisioning. Open the HTTPS
URL to verify it. Slipway does not provide certificate inspection commands.

To remove a custom hostname, pass an empty string as shown above. Access then
uses the configured generated hostname or the available direct-access route.

## Installation

```bash
npm install -g slipway-cli
# or
npx slipway-cli
```

## Part of the Slipway Suite

- **Slipway Dashboard** - The web UI (root of this monorepo)
- **sails-hook-slipway** - The Sails hook for Bridge, Helm, telemetry

---

_Where your apps slide into production._

### Deployment readiness

Run `slipway readiness --env production` after pushing source. Add `--app web` to select an app, or `--json` to return the same structured report used by the dashboard. Required checks block deployment; recommendations and optional capabilities do not. See the [readiness contract](../../docs/deployment-readiness.md) for source fingerprints, external connections, and explicitly required variables.
