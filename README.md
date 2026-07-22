<div align="center">
<br>
<img src="assets/images/slipway-wordmark.svg" alt="Slipway" height="40">
<br><br>
<p>The complete platform for Sails.js — deploy, manage, monitor, and debug your apps on your own infrastructure.</p>

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE.md)

</div>

---

## What is Slipway?

Slipway is an open-source, self-hosted platform purpose-built for **Sails.js** and **The Boring JavaScript Stack** applications. One command to install, one command to deploy.

- **One-command deploys** — `slipway slide` packages, pushes, and deploys your app with zero-downtime blue-green deployments
- **Self-hosted** — Runs on any Linux VPS you control. Your code, your data, your servers
- **Sails-native** — Understands your models, helpers, hooks, and config out of the box
- **Automatic HTTPS** — SSL certificates provisioned automatically via Caddy
- **Database management** — Provision PostgreSQL, MySQL, or Redis with one click. Connection URLs auto-injected
- **Built-in platform** — Helm (production REPL), Bridge (data management), Dock (SQL console), Quest (job scheduler), Content (CMS)
- **Backups** — Database backups to S3-compatible storage with one-click restore
- **Team collaboration** — Multi-user access with team management

## Quick Start

### Install on your server

SSH into your VPS and run:

```bash
curl -fsSL https://raw.githubusercontent.com/sailscastshq/slipway/main/install.sh | bash
```

This installs two containers (Slipway + Caddy proxy) and gives you a dashboard URL.

Slipway publishes direct application URLs from TCP ports `1338-1500`. The
installer adds that range to UFW or firewalld when either firewall is already
active; it does not enable a firewall or change your SSH rules. If your VPS
provider has a separate network firewall, allow inbound TCP `1338-1500` there
as well. Applications reached through a configured domain only require ports
`80` and `443`.

After the first deployment, validate direct access from a different machine or
network so the request crosses the provider firewall:

```bash
curl -I --connect-timeout 5 http://YOUR_SERVER_IP:ALLOCATED_PORT/health
```

The deployment log confirms the container health and live Docker mapping. If
those checks pass but this external request times out, the remaining boundary
is the VPS provider or host firewall.

### Run Slipway locally like production

When you want a local run that mirrors the production installer more closely than host-side `npm run dev`, use:

```bash
npm run local
```

This runs [local.sh](/Users/koo/Gringotts/687/slipway/local.sh), the local counterpart to [install.sh](/Users/koo/Gringotts/687/slipway/install.sh). It:

- builds the current checkout into a local Docker image
- creates or reuses the `slipway` Docker network
- persists local secrets under `.tmp/local/.env`
- persists local app source and SQLite data under `.tmp/local/`
- installs container dependencies into Docker volumes
- runs Slipway in Docker with `npm run dev`
- waits for `/health` before returning control

That means you still get the normal Slipway development loop, but through a runtime that is much closer to production:

- Docker-only runtime issues show up earlier
- asset/compiler problems are caught before a production deploy
- `/var/slipway/apps`, Docker socket access, and SQLite files behave like the real container setup
- the startup flow mirrors the structure of `install.sh`

Helpful companion commands:

```bash
npm run local:logs
npm run local:status
npm run local:shell
npm run local:stop
npm run local:down
npm run local:destroy
```

Local Docker data is kept under `.tmp/local/`, and container dependencies are cached in Docker volumes so reruns stay fast.

Command semantics:

- `npm run local:stop` stops the running container but keeps it for restart/debugging
- `npm run local:down` removes the local container
- `npm run local:destroy` removes the local container, cached Docker volumes, and `.tmp/local/` state for a full reset

### Deploy your app

```bash
# Install the CLI
npm install -g slipway-cli

# Login to your Slipway instance
slipway login --server https://slipway.yourdomain.com

# Initialize your project
cd my-sails-app
slipway init

# Deploy
slipway slide
```

## Architecture

```
┌──────────────────────────────────────────────────┐
│                    YOUR VPS                       │
│                                                   │
│  ┌────────────────────────────────────────────┐   │
│  │          SLIPWAY (Sails.js + Vue)          │   │
│  │  Dashboard · API · Deploy Engine · Platform │   │
│  └────────────────────┬───────────────────────┘   │
│                       │                           │
│  ┌────────────────────┴───────────────────────┐   │
│  │            Docker + Caddy Proxy            │   │
│  │  ┌──────┐ ┌──────┐ ┌───────┐ ┌─────────┐  │   │
│  │  │ app  │ │ app  │ │ redis │ │postgres │  │   │
│  │  └──────┘ └──────┘ └───────┘ └─────────┘  │   │
│  └────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────┘
```

**Key technology choices:**

| Component     | Choice                        | Why                                    |
| ------------- | ----------------------------- | -------------------------------------- |
| App framework | Sails.js + Vue 3 + Inertia.js | Dogfooding the stack                   |
| Database      | SQLite                        | Zero-config, single-file backup        |
| Proxy         | Caddy                         | Automatic HTTPS, Docker-native routing |
| Containers    | Docker                        | Universal runtime, no vendor lock-in   |
| Security      | `execFile()` everywhere       | No shell injection possible            |

## The Platform

Slipway includes integrated tools that work with your deployed Sails apps:

| Tool        | What it does                                                                      |
| ----------- | --------------------------------------------------------------------------------- |
| **Helm**    | Production REPL — query models, run helpers, inspect config from the browser      |
| **Bridge**  | Auto-generated data management UI from your Waterline models                      |
| **Dock**    | SQL console, schema diff, and migration tool for your databases                   |
| **Quest**   | Job scheduler dashboard for [sails-hook-quest](https://docs.sailscasts.com/quest) |
| **Content** | CMS for [sails-content](https://docs.sailscasts.com/content) markdown files       |
| **Lookout** | Infrastructure monitoring via [sails-hook-slipway](packages/hook) telemetry       |

## Requirements

- A Linux VPS with 1GB+ RAM (we recommend [Hetzner Cloud](https://www.hetzner.com/cloud/))
- Docker (auto-installed by the install script)
- Node.js 22+ on your local machine (for the CLI)

## Documentation

Full documentation at **[docs.sailscasts.com/slipway](https://docs.sailscasts.com/slipway)**

## Packages

This repo is a monorepo containing:

| Package                          | Description                                                               |
| -------------------------------- | ------------------------------------------------------------------------- |
| [`packages/cli`](packages/cli)   | Zero-dependency CLI (`slipway-cli` on npm)                                |
| [`packages/hook`](packages/hook) | Auto-instrumentation hook for deployed apps (`sails-hook-slipway` on npm) |

## Community

- [Discord](https://sailscasts.com/chat) — Chat with other developers
- [GitHub Issues](https://github.com/sailscastshq/slipway/issues) — Report bugs and request features
- [YouTube](https://youtube.com/@sailscasts) — Tutorials and updates

## License

Slipway is open-source software licensed under the [MIT license](LICENSE.md).
