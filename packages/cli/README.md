# slipway

> The CLI for Slipway - the Sails-native deployment platform

## Zero Dependencies

This CLI has **no npm dependencies**. It uses only Node.js 22+ built-ins:

- `node:util` → `parseArgs` for argument parsing
- `node:readline` → interactive prompts
- `node:fs` → config storage in `~/.slipway/`
- Native `fetch` → HTTP requests
- Native `WebSocket` → log streaming, Helm REPL

This means instant startup, no supply chain risk, and zero maintenance overhead.

## Commands

```bash
# Slide into production!
slipway slide                    # Primary command
slipway deploy                   # Alias
slipway launch                   # Alias

# Apps
slipway app:create myapp
slipway app:list
slipway app:info myapp
slipway app:destroy myapp

# Databases (unified)
slipway db:create mydb --type=postgres
slipway db:link mydb myapp       # Auto-sets DATABASE_URL
slipway db:connect mydb          # Opens psql/mysql/redis-cli
slipway db:list
slipway db:backup mydb

# Domains
slipway domain:add myapp example.com
slipway domain:list myapp
slipway domain:remove myapp example.com

# Environment
slipway env:set myapp KEY=value
slipway env:list myapp

# Operations
slipway helm myapp               # Sails REPL (like Tinkerwell)
slipway logs myapp -t            # Tail logs
slipway dev                      # Local dev mode
```

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
