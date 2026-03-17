# Slipway

> The Sails-native deployment platform. Where your apps slide into production.

---

## Table of Contents

1. [Vision](#vision)
2. [Why Slipway](#why-slipway)
3. [Learnings from Kamal & Dokku](#learnings-from-kamal--dokku)
4. [Core Philosophy](#core-philosophy)
5. [The CLI Experience](#the-cli-experience)
6. [Dev Mode: Local Companion](#dev-mode-local-companion)
7. [Complete Feature Set](#complete-feature-set)
8. [The Slipway Suite](#the-slipway-suite)
9. [Architecture](#architecture)
10. [Technology Stack](#technology-stack)
11. [Installation](#installation)
12. [The Acid Test](#the-acid-test)
13. [Market Analysis](#market-analysis)
14. [Feasibility & AI-Assisted Development](#feasibility--ai-assisted-development)
15. [Competitive Analysis](#competitive-analysis)
16. [Roadmap](#roadmap)
17. [Open Questions](#open-questions)

---

## Vision

Slipway is an open-source, self-hostable deployment platform purpose-built for **Sails.js** and **The Boring JavaScript Stack** applications. Think Coolify meets Laravel Forge meets Nova meets Tinker—but designed from the ground up to understand Sails applications deeply.

The goal: **One platform to deploy, manage, monitor, and administrate all your Sails applications and their databases.**

### The Tagline Options

- "Where Sails apps slide into production"
- "The Sails-native deployment platform"
- "Deploy Sails. Manage everything."

---

## Why Slipway

### The Problem Today

Developers building with Sails.js and The Boring JavaScript Stack have to cobble together:

- **Coolify/Dokploy** for deployment (generic, not Sails-aware)
- **AdminJS/Forest Admin** for admin panels (separate setup, not integrated)
- **Sentry/LogRocket** for error tracking (another service)
- **A REPL workaround** for production debugging (no elegant Tinker equivalent)
- **Separate job queue monitoring** (no Horizon equivalent)
- **Multiple dashboards** for different concerns

### What Laravel Developers Have

| Tool              | Purpose                          |
| ----------------- | -------------------------------- |
| Laravel Forge     | Server provisioning & deployment |
| Laravel Vapor     | Serverless deployment            |
| Laravel Nova      | Admin panel                      |
| Laravel Tinker    | Production REPL                  |
| Laravel Horizon   | Queue monitoring                 |
| Laravel Pulse     | Application monitoring           |
| Laravel Telescope | Debug assistant                  |

**Sails developers deserve the same integrated experience.**

### What Slipway Provides

A **single, unified platform** that:

- Deploys Sails apps (fullstack and serverless)
- Manages databases (PostgreSQL, MySQL, SQLite, Redis)
- Provides a Sails-aware admin panel (like Nova)
- Offers a production REPL (like Tinker/Guppy)
- Monitors queues (Sails Quest integration)
- Tracks errors and performance
- Detects and integrates Sails Content for CMS
- All with a **slick, modern dashboard** like Linear and Resend

---

## Learnings from Kamal & Dokku

Two deployment tools offer invaluable lessons for Slipway's design.

### From Kamal (37signals)

Kamal is Basecamp/37signals' deployment tool, used to run HEY and their internal apps.

#### Key Principles We're Adopting

| Principle              | What It Means                                                             | How Slipway Applies                             |
| ---------------------- | ------------------------------------------------------------------------- | ----------------------------------------------- |
| **Transparency**       | "You can see everything that's going on, it's just basic Docker commands" | Show users the actual Docker commands being run |
| **No Agents**          | SSH-based execution, no daemon on servers                                 | Direct SSH + Docker, minimal server footprint   |
| **Single Config File** | `config/deploy.yml` declares everything                                   | `config/slipway.js` for app configuration       |
| **Accessories**        | Databases/Redis as "accessories" alongside the app                        | First-class service management                  |
| **Zero-Downtime**      | Rolling deployments with kamal-proxy                                      | Caddy-based blue-green deployments              |

#### Kamal Commands Worth Emulating

```bash
# Kamal's excellent CLI patterns
kamal deploy              # Deploy to all servers
kamal rollback [VERSION]  # Instant rollback
kamal app exec 'rails c'  # Run command in container (their REPL)
kamal accessory boot all  # Start databases
kamal audit               # See deployment history
kamal details             # Show all container info
```

#### What Slipway Does Better

- **Sails-awareness**: Kamal is Ruby/Rails-focused
- **Integrated Admin**: Kamal deploys apps; you need separate admin
- **Web Dashboard**: Kamal is CLI-only
- **Helm/REPL**: Kamal's `exec` is generic; Slipway's Helm is Sails-native

---

### From Dokku

Dokku is a "mini-Heroku" - the smallest PaaS implementation.

#### Key Principles We're Adopting

| Principle               | What It Means                                      | How Slipway Applies                   |
| ----------------------- | -------------------------------------------------- | ------------------------------------- |
| **Git Push Deploy**     | `git push dokku main` triggers deploy              | Support git push alongside CLI deploy |
| **Plugin Architecture** | postgres, redis, mysql as plugins                  | Extensible service system             |
| **Service Linking**     | `dokku postgres:link mydb myapp` sets DATABASE_URL | Automatic env var injection           |
| **Procfile**            | Declare processes in a simple file                 | Respect Procfile for Sails apps       |
| **Buildpacks**          | Auto-detect app type and build                     | Use buildpacks or Dockerfile          |

#### Dokku Commands Worth Emulating

```bash
# Dokku's elegant CLI patterns
dokku apps:create myapp              # Create app
dokku postgres:create mydb           # Create database
dokku postgres:link mydb myapp       # Link with auto-env injection
dokku postgres:connect mydb          # Direct psql access
dokku ps:scale myapp web=2           # Scale processes
dokku domains:add myapp example.com  # Add domain
dokku config:set myapp KEY=value     # Set env vars
dokku logs myapp -t                  # Tail logs
```

#### The Service Linking Pattern

This is brilliant and Slipway must adopt it:

```bash
# When you link a service...
slipway postgres:link mydb myapp

# Slipway automatically sets:
# DATABASE_URL=postgres://user:pass@host:5432/mydb

# The app just reads process.env.DATABASE_URL
# Zero manual connection string management!
```

#### What Slipway Does Better

- **Sails-Native**: Dokku is generic; Slipway understands Sails
- **Admin Panel**: Dokku doesn't have one
- **Web Dashboard**: Dokku is CLI-only (though Dokku Pro adds UI)
- **Helm/REPL**: Dokku has `enter` but no framework-aware REPL

---

### The Hybrid Approach

Slipway combines the best of both:

| Feature            | Kamal           | Dokku         | Slipway              |
| ------------------ | --------------- | ------------- | -------------------- |
| Config file        | ✅ deploy.yml   | ❌            | ✅ config/slipway.js |
| Git push deploy    | ❌              | ✅            | ✅                   |
| CLI deploy         | ✅              | ✅            | ✅                   |
| Web dashboard      | ❌              | ❌ (Pro only) | ✅                   |
| Service linking    | ❌ (manual env) | ✅            | ✅                   |
| Plugin system      | ❌              | ✅            | ✅ (future)          |
| Transparent Docker | ✅              | ❌ (hidden)   | ✅                   |
| Framework-aware    | Rails (light)   | ❌            | ✅ Sails-native      |

---

## Core Philosophy

### 1. Sails-Native, Not Generic

Slipway **understands** Sails applications:

- Auto-detects `config/models.js`, `config/datastores.js`, `api/models/`
- Knows about Sails lifecycle, hooks, and policies
- Integrates with Sails Quest for job queues
- Recognizes Sails Content for CMS capabilities
- Provides a REPL where `await User.find()` just works

### 2. Lightweight First

Unlike Coolify (which can feel heavy), Slipway is designed to be:

- Minimal resource footprint
- Fast to install and boot
- Efficient with container orchestration
- No bloat—only what Sails apps need

### 3. Beautiful by Default

Dashboard design inspired by:

- **Linear** - Clean, fast, keyboard-driven
- **Resend** - Elegant, modern, developer-focused
- **Vercel** - Clear information hierarchy

### 4. Self-Hosted + Managed Cloud

- **Self-hosted**: Run on your own VPS, bare metal, or homelab
- **Slipway Cloud** (future): Managed offering for those who want hands-off

### 5. Open Source, Community Driven

MIT licensed, community contributions welcome, transparent development.

---

## The CLI Experience

The CLI is a **first-class citizen**, not an afterthought. Inspired by Kamal's transparency and Dokku's elegance.

### Design Principles

#### 1. Transparent by Default

Show what's happening. Don't hide Docker commands behind magic:

```bash
$ slipway slide myapp

  ▶ Building image...
    → docker build -t slipway/myapp:abc123 .

  ▶ Pushing to registry...
    → docker push slipway/myapp:abc123

  ▶ Stopping old container...
    → docker stop myapp-old

  ▶ Starting new container...
    → docker run -d --name myapp slipway/myapp:abc123

  ▶ Updating proxy routes...
    → caddy route myapp.example.com → myapp:1337

  ✓ Deployed myapp (v1.2.3) in 42s
    https://myapp.example.com
```

#### 2. Consistent Singular Resource Pattern

All resources use **singular** names for consistency (`app:` not `apps:`):

```bash
# Pattern: slipway <resource>:<action> [target] [options]

# Deploy (the fun command!)
slipway slide                         # Primary - "slide into production"
slipway launch                        # Alias
slipway deploy                        # Alias

# Apps
slipway app:create myapp
slipway app:list
slipway app:destroy myapp
slipway app:info myapp

# Databases (unified - works with postgres, mysql, redis)
slipway db:create mydb                     # Interactive: asks type
slipway db:create mydb --type=postgres     # Explicit type
slipway db:create mydb -t redis            # Short flag
slipway db:link mydb myapp                 # Auto-sets DATABASE_URL or REDIS_URL
slipway db:unlink mydb myapp
slipway db:connect mydb                    # Opens psql/mysql/redis-cli
slipway db:list
slipway db:backup mydb
slipway db:restore mydb backup.sql

# Domains
slipway domain:add myapp example.com
slipway domain:remove myapp example.com
slipway domain:list myapp

# Environment
slipway env:set myapp KEY=value
slipway env:unset myapp KEY
slipway env:list myapp

# Logs
slipway logs myapp
slipway logs myapp -t          # tail
slipway logs myapp -n 100      # last 100 lines

# Rollback
slipway rollback myapp
slipway rollback myapp v1.2.0
```

#### 3. Sails-Specific Commands

```bash
# Helm (the Tinkerwell experience)
slipway helm myapp
slipway helm myapp --readonly

# Inside the Helm:
> await User.find({ role: 'admin' })
> await sails.helpers.email.send(...)
> sails.config.custom

# Open app control panel in browser
slipway open myapp                # Opens app URL
slipway open myapp --bridge       # Opens /slipway/bridge
slipway open myapp --quest        # Opens /slipway/quest
```

#### 4. Top-Level Shorthand Commands

The most common operations don't need the `resource:action` pattern:

```bash
slipway slide             # Deploy current app
slipway logs myapp        # View logs
slipway helm myapp        # Open REPL
slipway dev               # Local dev mode with Bridge
```

#### 5. Interactive When Helpful

```bash
$ slipway slide

? Select application: (Use arrow keys)
❯ myapp-production
  myapp-staging
  another-app

$ slipway postgres:create

? Database name: mydb
? PostgreSQL version: (Use arrow keys)
❯ 16 (latest)
  15
  14
? Memory limit: 512MB
? Enable backups: Yes

Creating PostgreSQL database...
✓ Created postgres:mydb
  Connection: postgres://user:xxx@localhost:5432/mydb
```

#### 6. JSON Output for Scripting

```bash
# Human-readable (default)
$ slipway apps:list
NAME          STATUS    DOMAINS              CREATED
myapp         running   myapp.example.com    2 days ago
staging       running   staging.example.com  5 days ago

# JSON for scripting
$ slipway apps:list --json
[
  {"name": "myapp", "status": "running", "domains": ["myapp.example.com"]},
  {"name": "staging", "status": "running", "domains": ["staging.example.com"]}
]

# Quiet mode (just names/IDs)
$ slipway apps:list -q
myapp
staging
```

### Push to Deploy: The Superior Flow

Slipway's deployment model is designed to be **better than Heroku, Vercel, and Railway** while supporting private repos seamlessly.

#### The Problem with Existing Approaches

| Platform | Approach               | Private Repo Support | Pain Points                      |
| -------- | ---------------------- | -------------------- | -------------------------------- |
| Heroku   | `git push heroku main` | SSH keys required    | Key management, team scaling     |
| Vercel   | GitHub App             | ✅ Excellent         | GitHub-only, vendor lock-in      |
| Railway  | GitHub App             | ✅ Good              | Limited providers                |
| Dokku    | SSH-based push         | SSH keys required    | Manual key setup per user        |
| Coolify  | Webhooks + tokens      | Manual setup         | Token management, webhook config |
| Kamal    | CLI only               | N/A                  | No git integration               |

#### Slipway's Three Deployment Paths

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     SLIPWAY DEPLOYMENT OPTIONS                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐         │
│  │  🔗 Git Connect │  │  🔑 Deploy Token │  │  💻 CLI Direct  │         │
│  │   (Recommended) │  │   (CI/CD)       │  │   (Solo Dev)    │         │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘         │
│           │                    │                    │                   │
│           ▼                    ▼                    ▼                   │
│  ┌─────────────────────────────────────────────────────────────┐       │
│  │                    SLIPWAY BUILD ENGINE                      │       │
│  │  • Clone/fetch code                                          │       │
│  │  • Detect Sails.js app                                       │       │
│  │  • Build Docker image                                        │       │
│  │  • Zero-downtime deploy                                      │       │
│  └─────────────────────────────────────────────────────────────┘       │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

#### Path 1: Git Connect (Recommended)

**One-time setup, then push-to-deploy forever.** Works with GitHub, GitLab, Bitbucket, and self-hosted Git.

##### Step 1: Connect Your Git Provider

```bash
$ slipway git:connect

? Select Git provider:
❯ GitHub
  GitLab
  Bitbucket
  Self-hosted (any Git URL)

# For GitHub: Opens browser for OAuth
# For self-hosted: Prompts for credentials/token
```

##### Step 2: Link Repository to Project

```bash
# In Slipway dashboard, or via CLI:
$ slipway app:create myapp --repo=github.com/user/myapp

✓ Repository connected
✓ Deploy key added (read-only)
✓ Webhook configured

  Branch Mapping:
  • main     → production (https://myapp.example.com)
  • develop  → staging    (https://staging.myapp.example.com)
  • PR #*    → preview    (https://pr-123.myapp.example.com)
```

##### Step 3: Push to Deploy

```bash
# Just push to GitHub as normal
$ git push origin main

# Slipway receives webhook, starts deploy automatically
# View progress in dashboard or:
$ slipway logs myapp --deploy
```

##### How It Works (Technical)

```
┌──────────────┐     webhook      ┌──────────────┐
│   GitHub     │ ───────────────▶ │   Slipway    │
│  (push event)│                  │   Server     │
└──────────────┘                  └──────┬───────┘
                                         │
                                         │ 1. Validate webhook signature
                                         │ 2. Clone via deploy key (SSH)
                                         │ 3. Build Docker image
                                         │ 4. Deploy container
                                         │
                                         ▼
                                  ┌──────────────┐
                                  │  Your App    │
                                  │  (running)   │
                                  └──────────────┘
```

**For Private Repos:**

- Slipway generates a read-only **deploy key** (SSH)
- Key is added to your repo automatically via API
- No personal access tokens needed
- Key is scoped to single repo (principle of least privilege)

##### GitHub App Alternative

For organizations managing many repos, install the Slipway GitHub App:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Install Slipway                                                         │
│  ─────────────────                                                       │
│                                                                          │
│  Slipway requests access to:                                            │
│                                                                          │
│  ✓ Read access to code (to clone and build)                             │
│  ✓ Read access to metadata (repo info)                                  │
│  ✓ Write access to commit statuses (deploy status checks)               │
│  ✓ Write access to deployments (GitHub Deployments API)                 │
│  ✓ Read access to pull requests (for preview environments)              │
│                                                                          │
│  Select repositories:                                                    │
│  ◉ All repositories                                                     │
│  ○ Only select repositories                                             │
│                                                                          │
│                                    [Install & Authorize]                 │
└─────────────────────────────────────────────────────────────────────────┘
```

---

#### Path 2: Deploy Tokens (CI/CD Integration)

For teams with existing CI/CD pipelines, or when you want full control over when deploys happen.

##### Generate Token

```bash
$ slipway token:create --name="GitHub Actions" --scope=deploy

✓ Token created: slp_live_abc123...

  Add this to your CI secrets:
  SLIPWAY_TOKEN=slp_live_abc123...

  Token permissions:
  • Deploy to linked apps
  • View deploy logs
  • Cannot modify settings
```

##### GitHub Actions Example

```yaml
# .github/workflows/deploy.yml
name: Deploy to Slipway

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Deploy to Slipway
        run: npx slipway slide
        env:
          SLIPWAY_TOKEN: ${{ secrets.SLIPWAY_TOKEN }}
          SLIPWAY_SERVER: https://slipway.yourdomain.com
```

##### GitLab CI Example

```yaml
# .gitlab-ci.yml
deploy:
  stage: deploy
  script:
    - npx slipway slide
  variables:
    SLIPWAY_TOKEN: $SLIPWAY_TOKEN
  only:
    - main
```

##### Why Tokens Over SSH Keys

| Aspect       | SSH Keys             | Deploy Tokens              |
| ------------ | -------------------- | -------------------------- |
| Rotation     | Manual, disruptive   | One-click, instant         |
| Scoping      | Per-machine          | Per-action (deploy only)   |
| Revocation   | Hunt down all copies | Single click in dashboard  |
| Audit trail  | None                 | Full history in dashboard  |
| Team scaling | Each dev needs key   | Share token via CI secrets |

---

#### Path 3: CLI Direct Push

For solo developers or when you want to deploy local changes without pushing to Git first.

```bash
# One-time setup
$ slipway login
$ cd my-sails-app
$ slipway link

# Deploy anytime
$ slipway slide

  ▶ Packaging local files...
    → Creating tarball (excluding node_modules, .git)

  ▶ Uploading to Slipway...
    → 2.3 MB uploaded

  ▶ Building image...
    → docker build -t slipway/myapp:local-abc123 .

  ▶ Deploying...
    → Stopping old container
    → Starting new container
    → Health check passed

  ✓ Deployed myapp in 47s
    https://myapp.example.com

  ⚠️  Note: This deploy is not linked to a Git commit.
      For production, we recommend pushing to Git first.
```

**When to Use CLI Direct:**

- Testing changes before committing
- Hotfixes that need immediate deployment
- Environments without CI/CD
- Personal projects

---

#### Branch-Based Environments

Slipway automatically maps branches to environments:

```javascript
// config/slipway.js
module.exports.slipway = {
  environments: {
    production: {
      branch: 'main',
      domain: 'myapp.example.com',
      autoDeploy: true
    },
    staging: {
      branch: 'develop',
      domain: 'staging.myapp.example.com',
      autoDeploy: true
    },
    // Preview environments for PRs
    preview: {
      pattern: 'pr-*',
      domain: '{{branch}}.preview.myapp.example.com',
      autoDeploy: true,
      autoDestroy: true, // Delete when PR is closed
      ttl: '7d' // Or after 7 days of inactivity
    }
  }
}
```

##### PR Preview Environments

When a PR is opened:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Pull Request #42: Add user dashboard                                    │
│  ─────────────────────────────────────────────────────────────────────  │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ 🚀 Slipway Preview                                                  │ │
│  │                                                                     │ │
│  │ Preview deployed successfully!                                      │ │
│  │                                                                     │ │
│  │ 🔗 https://pr-42.preview.myapp.example.com                          │ │
│  │                                                                     │ │
│  │ This preview will be automatically deleted when the PR is closed.  │ │
│  │                                                                     │ │
│  │ Updated 2 minutes ago • Build time: 34s                            │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

#### Comparison: Slipway vs Others

| Feature              | Heroku   | Vercel     | Railway    | Slipway         |
| -------------------- | -------- | ---------- | ---------- | --------------- |
| Private repo support | SSH keys | GitHub App | GitHub App | **All methods** |
| GitLab/Bitbucket     | Limited  | ❌         | Limited    | ✅ Full         |
| Self-hosted Git      | ❌       | ❌         | ❌         | ✅              |
| PR previews          | ❌       | ✅         | ✅         | ✅              |
| Branch environments  | Manual   | ✅         | ✅         | ✅              |
| Deploy without push  | ❌       | ❌         | ❌         | ✅ CLI direct   |
| CI/CD tokens         | ❌       | ❌         | ❌         | ✅              |
| Self-hosted          | ❌       | ❌         | ❌         | ✅              |
| Monorepo support     | Limited  | ✅         | Limited    | ✅              |
| Framework-aware      | ❌       | ❌         | ❌         | ✅ Sails        |

---

#### The Slipway Advantage

1. **No vendor lock-in**: Self-hosted, works with any Git provider
2. **Flexibility**: Three deployment paths for different needs
3. **Security**: Deploy keys scoped per-repo, tokens scoped per-action
4. **Developer experience**: Push to GitHub = deployed, or CLI for quick deploys
5. **Team-friendly**: Tokens for CI/CD, no SSH key management
6. **Framework-aware**: Sails.js optimization, not generic buildpacks

### CLI Technology Stack

**Zero npm dependencies.** The CLI uses only Node.js 22+ built-ins:

| Need                | Node.js Built-in      | Notes                              |
| ------------------- | --------------------- | ---------------------------------- |
| Argument parsing    | `node:util` parseArgs | Replaces Commander.js              |
| Interactive prompts | `node:readline`       | Replaces Inquirer.js               |
| HTTP requests       | Native `fetch`        | No axios/undici needed             |
| WebSocket           | Native `WebSocket`    | For log streaming, Helm            |
| Colors/styling      | Raw ANSI codes        | No chalk needed                    |
| Config storage      | `node:fs`             | Writes to `~/.slipway/config.json` |

This means:

- **Instant startup** — no node_modules to load
- **No supply chain risk** — nothing to audit
- **Simpler maintenance** — no dependency updates

---

## Dev Mode: Local Companion

A **game-changing** feature: Slipway isn't just for production—it's your local development companion.

### The Vision

```bash
# In your Sails project directory
$ slipway dev

  ╭──────────────────────────────────────────────────╮
  │                                                  │
  │   Slipway Dev Mode                               │
  │                                                  │
  │   App:      http://localhost:1337                │
  │   Bridge:   http://localhost:1337/slipway/bridge │
  │   Helm:     http://localhost:1337/slipway/helm   │
  │   Quest:    http://localhost:1337/slipway/quest  │
  │                                                  │
  │   Press 'b' for Bridge, 'h' for Helm             │
  │   Press 'q' to quit                              │
  │                                                  │
  ╰──────────────────────────────────────────────────╯

  [12:34:56] Sails lifted successfully
  [12:34:57] Bridge ready (12 models detected)
  [12:34:57] Helm ready
```

### What Dev Mode Provides

#### 1. Integrated Bridge (Locally!)

No need to deploy to get Nova-like data management:

```
http://localhost:1337/slipway/bridge
```

- Auto-generated CRUD for all your models
- Browse and edit data during development
- Test relationships visually
- Export data for seeding

#### 2. Local Helm (REPL)

Web-based REPL in your browser:

```
http://localhost:1337/slipway/helm
```

Or in terminal:

```bash
$ slipway dev:helm

Slipway Helm (myapp development)
Type .help for available commands

> await User.find().limit(3)
[
  { id: 1, email: 'test@example.com' },
  { id: 2, email: 'admin@example.com' },
  { id: 3, email: 'user@example.com' }
]

> await Post.count()
42

> .tables
┌─────────────┬────────┬──────────────────────┐
│ Model       │ Count  │ Last Updated         │
├─────────────┼────────┼──────────────────────┤
│ User        │ 156    │ 2 minutes ago        │
│ Post        │ 42     │ 5 minutes ago        │
│ Comment     │ 891    │ 1 minute ago         │
└─────────────┴────────┴──────────────────────┘
```

#### 3. Quest Dashboard (Locally!)

If using Sails Quest:

```
http://localhost:1337/slipway/quest
```

- See all queued jobs
- Manually trigger jobs
- Inspect failed jobs
- Clear queues

#### 4. Database Tools

```bash
$ slipway dev:db

  Database: PostgreSQL (development)

  Commands:
    .schema          Show all tables
    .describe User   Show User model schema
    .sql             Run raw SQL
    .seed            Run seeders
    .reset           Reset database (migrate:fresh)
    .backup          Create backup
```

#### 5. Live Model Inspector

Visual inspection of Waterline models:

```
http://localhost:1337/slipway/models
```

- See all model definitions
- View relationships graph
- Test queries visually
- Generate API documentation

### How It Works Technically

The `sails-hook-slipway` package provides all these features. When installed, it:

```javascript
// What sails-hook-slipway does:

// 1. Detects available features:
//    - Bridge (always)
//    - Helm (always)
//    - Quest dashboard (if sails-quest installed)
//    - Content CMS (if sails-content installed)

// 2. Registers routes:
//    /slipway         → Control panel dashboard
//    /slipway/bridge  → The Bridge (data management)
//    /slipway/helm    → The Helm (REPL)
//    /slipway/quest   → Queue dashboard (conditional)
//    /slipway/content → CMS interface (conditional)

// 3. Introspects models via Waterline
// 4. Sends telemetry to Slipway server (if configured)
```

### Configuration

```javascript
// config/slipway.js - JavaScript, not YAML!
module.exports.slipway = {
  // Hook settings (sails-hook-slipway)
  bridge: {
    enabled: true,
    path: '/slipway/bridge'
  },
  helm: {
    enabled: true,
    path: '/slipway/helm',
    readOnly: false // Set true in production for safety
  },
  quest: {
    enabled: true, // Auto-disabled if sails-quest not installed
    path: '/slipway/quest'
  },
  content: {
    enabled: true, // Auto-disabled if sails-content not installed
    path: '/slipway/content'
  },

  // Production deployment
  deploy: {
    servers: [process.env.SLIPWAY_SERVER || 'deploy@myserver.com'],
    registry: process.env.DOCKER_REGISTRY || 'registry.example.com',

    // Environment-specific overrides
    production: {
      domain: 'myapp.example.com',
      ssl: true
    },
    staging: {
      domain: 'staging.myapp.example.com'
    }
  },

  // Services (databases, redis, etc.)
  services: {
    postgres: {
      version: '16',
      name: 'myapp-db'
    },
    redis: {
      version: '7',
      name: 'myapp-cache'
    }
  }
}
```

**Why JavaScript, not YAML?**

- Consistent with Sails conventions (`config/*.js`)
- Full JavaScript power: functions, conditionals, `process.env`
- Comments that work
- Import/require other modules
- Type hints with JSDoc if desired

### Dev Mode vs Production

| Feature | Dev Mode                      | Production                     |
| ------- | ----------------------------- | ------------------------------ |
| Bridge  | `/slipway/bridge` open access | Role-based via Sails Clearance |
| Helm    | Open access                   | Role-based, audit logged       |
| Quest   | Full control                  | Read + retry only              |
| Content | Full control                  | Role-based (editors, admins)   |
| Auth    | Optional/none                 | Required via Sails Clearance   |

### Why This Matters

1. **Faster Development**: No more writing one-off scripts to inspect data
2. **Better Debugging**: Helm access without separate REPL setup
3. **Visual Data Management**: The Bridge during development
4. **Queue Testing**: Test Quest jobs without production deployment
5. **Seamless Transition**: Same tools locally and in production

### The Full Dev Workflow

```bash
# 1. Start new project
sails new myapp
cd myapp

# 2. Initialize Slipway
slipway init

# 3. Start dev mode (replaces `sails lift`)
slipway dev

# 4. Open the Bridge, create some data
# http://localhost:1337/slipway/bridge

# 5. Test queries in the Helm
# http://localhost:1337/slipway/helm

# 6. When ready to deploy
slipway slide
```

---

## Complete Feature Set

### Deployment & Infrastructure

#### Application Deployment

- [ ] One-click deploy from Git (GitHub, GitLab, Bitbucket)
- [ ] Automatic builds with buildpack detection
- [ ] Docker-based isolation
- [ ] Zero-downtime deployments (rolling updates)
- [ ] Instant rollbacks to any previous deployment
- [ ] Environment variable management (with encryption)
- [ ] Secret management (encrypted at rest)
- [ ] Deploy previews for pull requests
- [ ] Multi-environment support (staging, production, custom)

#### Sails-Specific Deployment

- [ ] Auto-detection of Sails applications
- [ ] Sails lift configuration management
- [ ] Hook initialization monitoring
- [ ] Waterline ORM connection status
- [ ] Asset pipeline (Grunt/Webpack) build integration
- [ ] Sails.js version compatibility checking

#### Serverless Sails

- [ ] Deploy Sails actions as serverless functions
- [ ] Cold start optimization
- [ ] Edge deployment options
- [ ] Automatic scaling
- [ ] Usage-based billing metrics

#### Server Management

- [ ] SSH key management
- [ ] Server health monitoring
- [ ] Resource usage tracking (CPU, RAM, Disk)
- [ ] Automatic security updates
- [ ] Firewall configuration
- [ ] SSL/TLS certificate management (Let's Encrypt auto-renewal)

### Database Management

#### Supported Databases

- [ ] **PostgreSQL** - Full support with connection pooling
- [ ] **MySQL/MariaDB** - Full support
- [ ] **SQLite** - Embedded database support
- [ ] **MongoDB** - Document database support
- [ ] **Redis** - Caching and session storage

#### Database Features

- [ ] One-click database provisioning
- [ ] Automatic backups (configurable schedule)
- [ ] Point-in-time recovery
- [ ] Database cloning for staging
- [ ] Connection string management
- [ ] Slow query detection
- [ ] Query analytics
- [ ] Visual schema browser
- [ ] Data export/import tools
- [ ] Database migrations tracking

#### Sails Waterline Integration

- [ ] Auto-configure datastores from detected config
- [ ] Model-aware database browser
- [ ] Relationship visualization
- [ ] Migration status dashboard

### Proxy & Networking

#### Reverse Proxy

- [ ] Automatic SSL termination
- [ ] HTTP/2 and HTTP/3 support
- [ ] WebSocket proxying (critical for Sails sockets)
- [ ] Load balancing across instances
- [ ] Rate limiting configuration
- [ ] IP allowlist/blocklist

#### Domain Management

- [ ] Easy custom domain setup
- [ ] Automatic DNS configuration helpers
- [ ] Wildcard domain support
- [ ] Subdomain routing
- [ ] Domain health monitoring

### The Helm (Slipway Helm)

This is the **Tinkerwell equivalent**—a production-safe REPL for Sails applications. Named after the ship's **helm** — where you steer and command the vessel.

Inspired by [Tinkerwell](https://tinkerwell.app/), the Helm provides a powerful web-based REPL with multi-line editing, autocompletion, and output visualization.

#### Features

- [ ] Full Sails environment loaded (`sails.models`, `sails.helpers`, etc.)
- [ ] Direct model queries: `await User.find({ email: 'test@example.com' })`
- [ ] Helper execution: `await sails.helpers.email.send(...)`
- [ ] Action invocation for testing
- [ ] Read-only mode option (for safety)
- [ ] Query history and favorites
- [ ] Syntax highlighting and autocomplete
- [ ] Multi-line editing
- [ ] Output formatting (tables, JSON, pretty print)
- [ ] Exportable results

#### Safety Features

- [ ] Audit logging of all Helm commands
- [ ] Role-based access (who can run what)
- [ ] Read-only mode by default
- [ ] Dangerous operation warnings
- [ ] Transaction wrapping option

### The Bridge (Slipway Bridge)

A **Laravel Nova equivalent** built into Slipway. Named after the ship's **bridge** — the command center where the captain navigates and controls the vessel.

#### Resource Management

- [ ] Auto-generated CRUD for all Sails models
- [ ] Customizable list views (columns, filters, sorting)
- [ ] Inline editing
- [ ] Bulk actions
- [ ] Relationship management (hasMany, belongsTo, etc.)
- [ ] File upload handling

#### Custom Fields

- [ ] Text, textarea, markdown editor
- [ ] Number, currency, percentage
- [ ] Date, datetime, time
- [ ] Select, multi-select, tags
- [ ] Boolean, switch
- [ ] File, image with preview
- [ ] JSON editor
- [ ] Code editor
- [ ] Relationship selectors

#### Dashboard Widgets

- [ ] Stats cards (counts, sums, averages)
- [ ] Charts (line, bar, pie, area)
- [ ] Recent activity feeds
- [ ] Custom metric displays

#### Access Control

- [ ] User roles and permissions
- [ ] Field-level permissions
- [ ] Action-level permissions
- [ ] Activity audit log

### Queue Management (Sails Quest Integration)

For applications using **Sails Quest** (or compatible job queues).

#### Features

- [ ] Job queue dashboard
- [ ] Real-time job status (pending, processing, completed, failed)
- [ ] Job retry functionality
- [ ] Job cancellation
- [ ] Failed job inspection (payload, error, stack trace)
- [ ] Queue throughput metrics
- [ ] Worker status monitoring
- [ ] Job scheduling visualization
- [ ] Batch job tracking

### CMS Integration (Sails Content Detection)

If **Sails Content** is detected in the application:

#### Features

- [ ] Content type browser
- [ ] Visual content editor
- [ ] Media library integration
- [ ] Content versioning
- [ ] Draft/publish workflow
- [ ] Scheduled publishing
- [ ] Content API preview

### Observability Suite

#### Error Tracking

- [ ] Automatic error capture from Sails apps
- [ ] Stack trace analysis with source maps
- [ ] Error grouping and deduplication
- [ ] Error trends and frequency
- [ ] Assignment and resolution tracking
- [ ] Integration with Sails error handling
- [ ] Slack/Discord/email notifications

#### Application Monitoring

- [ ] Request/response metrics
- [ ] Response time tracking (p50, p95, p99)
- [ ] Throughput metrics (requests/minute)
- [ ] Error rate tracking
- [ ] Endpoint-level breakdown
- [ ] Database query performance
- [ ] Memory and CPU profiling
- [ ] Custom metric ingestion

#### Logging

- [ ] Centralized log aggregation
- [ ] Log search and filtering
- [ ] Log streaming (real-time tail)
- [ ] Log retention policies
- [ ] Structured logging support
- [ ] Log-based alerting

#### Uptime Monitoring

- [ ] HTTP endpoint monitoring
- [ ] Custom check intervals
- [ ] Multi-region checks
- [ ] Status page generation
- [ ] Incident tracking
- [ ] Downtime notifications

### Analytics

#### Application Analytics

- [ ] Page view tracking
- [ ] User session analytics
- [ ] Geographic distribution
- [ ] Device and browser breakdown
- [ ] Referrer tracking
- [ ] Custom event tracking

#### Business Metrics

- [ ] Custom KPI dashboards
- [ ] Funnel analysis
- [ ] Cohort analysis
- [ ] A/B test result tracking

### Security

#### Application Security

- [ ] Dependency vulnerability scanning
- [ ] SAST (Static Application Security Testing)
- [ ] Secret scanning in code
- [ ] Security headers configuration
- [ ] CORS configuration management

#### Platform Security

- [ ] Two-factor authentication
- [ ] SSO support (SAML, OIDC)
- [ ] Role-based access control
- [ ] API key management
- [ ] Audit logging
- [ ] IP restrictions

### Collaboration Features

#### Team Management

- [ ] Team invitations
- [ ] Role assignment (Admin, Developer, Viewer)
- [ ] Project-level permissions
- [ ] Activity feed

#### Notifications

- [ ] In-app notifications
- [ ] Email notifications
- [ ] Slack integration
- [ ] Discord integration
- [ ] Webhook integrations
- [ ] PagerDuty/Opsgenie integration

---

## The Slipway Suite

All-in-one integrated tools that come with Slipway:

| Component             | Equivalent To     | Description                     |
| --------------------- | ----------------- | ------------------------------- |
| **Slipway Deploy**    | Forge/Coolify     | Deployment & infrastructure     |
| **Slipway Helm**      | Tinkerwell        | Production REPL for Sails       |
| **Slipway Bridge**    | Nova/Nexus        | Auto-generated data management  |
| **Slipway Pulse**     | Laravel Pulse     | Application monitoring          |
| **Slipway Horizon**   | Laravel Horizon   | Queue monitoring (Quest)        |
| **Slipway Telescope** | Laravel Telescope | Debug & inspection              |
| **Slipway Content**   | -                 | CMS when Sails Content detected |
| **Slipway Guard**     | -                 | Error tracking                  |
| **Slipway Metrics**   | -                 | Analytics dashboard             |

---

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        SLIPWAY PLATFORM                          │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   Web UI    │  │   CLI Tool  │  │       REST API          │  │
│  │ (Vue/Inertia)│  │  (slipway)  │  │     (Sails Actions)     │  │
│  └──────┬──────┘  └──────┬──────┘  └────────────┬────────────┘  │
│         │                │                       │               │
│         └────────────────┼───────────────────────┘               │
│                          │                                       │
│  ┌───────────────────────┴────────────────────────────────────┐  │
│  │                    SLIPWAY CORE                             │  │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐           │  │
│  │  │  Deployer   │ │  Database   │ │   Proxy     │           │  │
│  │  │  Service    │ │  Manager    │ │   Manager   │           │  │
│  │  └─────────────┘ └─────────────┘ └─────────────┘           │  │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐           │  │
│  │  │    Helm     │ │   Bridge    │ │  Monitor    │           │  │
│  │  │   (REPL)    │ │   Panel     │ │  Service    │           │  │
│  │  └─────────────┘ └─────────────┘ └─────────────┘           │  │
│  └────────────────────────────────────────────────────────────┘  │
│                          │                                       │
│  ┌───────────────────────┴────────────────────────────────────┐  │
│  │                    CONTAINER RUNTIME                        │  │
│  │                (Docker / Podman / containerd)               │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                          │                                       │
│  ┌───────────────────────┴────────────────────────────────────┐  │
│  │                    DATA LAYER                               │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐   │  │
│  │  │ SQLite   │ │ Postgres │ │  Redis   │ │ File Storage │   │  │
│  │  │(Slipway) │ │  (Apps)  │ │  (Apps)  │ │    (Apps)    │   │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘  │
│  └─────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Key Architectural Decisions

#### 1. Built with Sails & The Boring JavaScript Stack

- **Sails.js** - Backend framework
- **Vue 3 + Inertia.js** - Frontend SPA without API layer
- **Tailwind CSS** - Styling
- **sails-sqlite** - Slipway's own database (lightweight, embedded)
- **Redis** (optional) - For clustering Slipway itself

#### 2. Container-Based Isolation (Docker-First)

Following Kamal's approach, Docker is central but **transparent**:

```
┌─────────────────────────────────────────────────────────────┐
│                    DOCKER ENVIRONMENT                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │    caddy     │  │   slipway    │  │   registry   │       │
│  │   (proxy)    │  │   (platform) │  │   (optional) │       │
│  └──────┬───────┘  └──────────────┘  └──────────────┘       │
│         │                                                    │
│         │ routes to                                          │
│         ▼                                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │   myapp      │  │   staging    │  │   api        │       │
│  │   (sails)    │  │   (sails)    │  │   (sails)    │       │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘       │
│         │                 │                 │                │
│         │ connects to     │                 │                │
│         ▼                 ▼                 ▼                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │   postgres   │  │    redis     │  │    mysql     │       │
│  │   (data)     │  │   (cache)    │  │   (data)     │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│                                                              │
│  Volumes: /data/postgres, /data/redis, /data/apps           │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Key Docker Principles:**

- Each app = one container (simple, isolated)
- Each database = one container with persistent volume
- Caddy handles routing, SSL, WebSockets
- No orchestration complexity (no Swarm, no K8s)
- `docker compose` for local dev, direct Docker API for production

**Caddy Docker Labels (via caddy-docker-proxy):**

```javascript
// When deploying a container, we add these labels
const labels = {
  caddy: 'myapp.example.com', // Domain
  'caddy.reverse_proxy': '{{upstreams 3000}}' // Proxy to port 3000
  // That's it! SSL is automatic via Let's Encrypt
}

// For WebSocket support (Sails sockets)
const labelsWithWS = {
  caddy: 'myapp.example.com',
  'caddy.reverse_proxy': '{{upstreams 3000}}',
  'caddy.reverse_proxy.transport': 'http'
}
```

**Why Caddy over Traefik:**

- Simpler labels (2 vs 5+ for basic setup)
- Automatic HTTPS with zero config
- Lighter memory footprint (~40MB vs ~80MB)
- Caddyfile readable if needed for debugging

#### 3. Sails-Aware Intelligence

- Custom Sails app analyzer (detects models, config, hooks)
- Waterline introspection for admin panel generation
- Sails lifecycle integration for REPL

### Component Details

#### Deployer Service

- Clones Git repositories
- Builds Docker images (buildpacks or Dockerfile)
- Manages container lifecycle
- Handles zero-downtime deployments

#### Database Manager

- Provisions database containers
- Manages backups and restores
- Handles connection pooling
- Monitors database health

#### Proxy Manager

- Configures Caddy routes via Docker labels
- Manages SSL certificates
- Handles WebSocket upgrades
- Implements rate limiting

#### Helm Service

- Spawns isolated Sails REPL sessions
- Connects to target app's database
- Loads app's models and helpers
- Executes commands in sandboxed environment

#### Bridge Generator

- Introspects Sails models via Waterline
- Generates CRUD interfaces
- Handles file uploads
- Manages relationships

#### Monitor Service

- Collects metrics from running containers
- Aggregates logs
- Tracks errors
- Generates alerts

#### Git Integration Service

The Git integration is the heart of push-to-deploy. Here's how it works:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      GIT INTEGRATION ARCHITECTURE                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                     Git Providers                                │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐    │   │
│  │  │  GitHub  │  │  GitLab  │  │ Bitbucket│  │ Self-hosted  │    │   │
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────┬───────┘    │   │
│  │       │              │              │              │             │   │
│  │       │  Webhooks    │              │              │             │   │
│  │       └──────────────┴──────────────┴──────────────┘             │   │
│  │                              │                                    │   │
│  └──────────────────────────────┼────────────────────────────────────┘   │
│                                 │                                        │
│                                 ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    Webhook Handler                               │   │
│  │  • Verify signature (HMAC-SHA256)                               │   │
│  │  • Parse event type (push, PR, tag)                             │   │
│  │  • Queue deployment job                                          │   │
│  └────────────────────────────────┬────────────────────────────────┘   │
│                                   │                                      │
│                                   ▼                                      │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    Deployment Queue                              │   │
│  │  • Rate limiting (prevent deploy storms)                        │   │
│  │  • Deduplication (skip if same commit already deploying)        │   │
│  │  • Priority (production > staging > preview)                    │   │
│  └────────────────────────────────┬────────────────────────────────┘   │
│                                   │                                      │
│                                   ▼                                      │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    Build Worker                                  │   │
│  │                                                                  │   │
│  │  1. Clone Repository                                            │   │
│  │     ├─ GitHub: Deploy key (SSH) or GitHub App token            │   │
│  │     ├─ GitLab: Deploy token or OAuth                           │   │
│  │     └─ Self-hosted: SSH key or HTTPS with token                │   │
│  │                                                                  │   │
│  │  2. Detect App Type                                             │   │
│  │     ├─ Sails.js → Use Sails-optimized Dockerfile               │   │
│  │     ├─ Has Dockerfile → Use provided Dockerfile                │   │
│  │     └─ Other Node.js → Use generic Node Dockerfile             │   │
│  │                                                                  │   │
│  │  3. Build Docker Image                                          │   │
│  │     ├─ Layer caching (npm install cached if package.json same) │   │
│  │     ├─ Build args injection (NODE_ENV, etc.)                   │   │
│  │     └─ Multi-stage build (small final image)                   │   │
│  │                                                                  │   │
│  │  4. Deploy Container                                            │   │
│  │     ├─ Health check before switching                           │   │
│  │     ├─ Zero-downtime swap                                       │   │
│  │     └─ Rollback on failure                                      │   │
│  │                                                                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

##### Database Schema for Git Integration

```javascript
// api/models/GitProvider.js
module.exports = {
  attributes: {
    type: { type: 'string', isIn: ['github', 'gitlab', 'bitbucket', 'custom'] },
    name: { type: 'string' }, // "GitHub" or custom name

    // OAuth credentials (encrypted)
    clientId: { type: 'string', encrypt: true },
    clientSecret: { type: 'string', encrypt: true },

    // For GitHub App
    appId: { type: 'string' },
    privateKey: { type: 'string', encrypt: true },
    installationId: { type: 'string' },

    // For self-hosted
    apiUrl: { type: 'string' }, // e.g., https://gitlab.company.com/api/v4

    team: { model: 'team' }
  }
}

// api/models/GitRepository.js
module.exports = {
  attributes: {
    provider: { model: 'gitprovider' },

    // Repository identifiers
    externalId: { type: 'string' }, // GitHub repo ID
    fullName: { type: 'string' }, // "user/repo"
    cloneUrl: { type: 'string' }, // git@github.com:user/repo.git
    defaultBranch: { type: 'string' }, // "main"

    // Access credentials (encrypted)
    deployKeyId: { type: 'string' }, // GitHub deploy key ID (for deletion)
    deployKeyPrivate: { type: 'string', encrypt: true }, // SSH private key

    // Webhook
    webhookId: { type: 'string' },
    webhookSecret: { type: 'string', encrypt: true },

    // Link to Slipway app
    app: { model: 'app' },

    // Branch → Environment mapping
    branchMappings: { type: 'json' }
    // e.g., { "main": "production", "develop": "staging", "pr-*": "preview" }
  }
}

// api/models/DeployToken.js
module.exports = {
  attributes: {
    name: { type: 'string' }, // "GitHub Actions"
    token: { type: 'string' }, // slp_live_abc123...
    tokenHash: { type: 'string' }, // For lookup without storing plain token

    scopes: { type: 'json' }, // ["deploy", "logs"]

    lastUsedAt: { type: 'number' },
    expiresAt: { type: 'number' }, // Optional expiry

    app: { model: 'app' }, // Scoped to specific app
    user: { model: 'user' } // Who created it
  }
}
```

##### Webhook Endpoint

```javascript
// api/controllers/webhook/github.js
module.exports = {
  fn: async function (req, res) {
    const signature = req.headers['x-hub-signature-256']
    const event = req.headers['x-github-event']
    const payload = req.body

    // 1. Find repository by webhook
    const repo = await GitRepository.findOne({
      externalId: String(payload.repository.id)
    })

    if (!repo) {
      return res.notFound()
    }

    // 2. Verify signature
    const isValid = sails.helpers.git.verifyWebhookSignature(
      req.rawBody,
      signature,
      repo.webhookSecret
    )

    if (!isValid) {
      return res.forbidden('Invalid signature')
    }

    // 3. Handle event
    switch (event) {
      case 'push':
        await sails.helpers.git.handlePushEvent(repo, payload)
        break

      case 'pull_request':
        await sails.helpers.git.handlePullRequestEvent(repo, payload)
        break

      case 'delete':
        // Branch deleted - clean up preview environment
        await sails.helpers.git.handleDeleteEvent(repo, payload)
        break
    }

    return res.ok({ received: true })
  }
}
```

##### CLI Deploy Token Flow

```javascript
// packages/cli/src/commands/slide.js
async function slide(options) {
  // 1. Check for token (CI/CD mode)
  const token = process.env.SLIPWAY_TOKEN || options.token

  if (token) {
    // Token-based deploy (CI/CD)
    return await deployWithToken(token, options)
  }

  // 2. Check for saved credentials (interactive mode)
  const config = await loadConfig()

  if (!config.server || !config.sessionToken) {
    console.log('Not logged in. Run: slipway login')
    process.exit(1)
  }

  // 3. Check if current directory is linked to an app
  const linkedApp = await getLinkedApp()

  if (!linkedApp) {
    console.log('Not linked to an app. Run: slipway link')
    process.exit(1)
  }

  // 4. Package and upload local files
  const tarball = await createTarball({
    exclude: ['node_modules', '.git', '.env', '*.log']
  })

  // 5. Upload and trigger deploy
  const deployment = await api.post(`/apps/${linkedApp.id}/deploy`, {
    source: 'cli-direct',
    tarball: tarball.toString('base64')
  })

  // 6. Stream logs
  await streamDeploymentLogs(deployment.id)
}
```

---

## Technology Stack

### The Boring JavaScript Stack

Slipway is built with [The Boring JavaScript Stack](https://docs.sailscasts.com/boring-stack):

- **Sails.js** - Backend framework
- **Vue 3 + Inertia.js** - Frontend (no separate API layer)
- **Tailwind CSS** - Styling
- **sails-sqlite** - Database (based on better-sqlite3)

Each Vue page receives data as props from Sails controllers - no REST/GraphQL API needed.

### Project Structure

```
slipway/
├── api/                         # Sails API (the dashboard IS the root)
│   ├── controllers/
│   │   ├── app/                 # App management
│   │   ├── db/                  # Database management
│   │   ├── domain/              # Domain management
│   │   └── auth/                # Authentication
│   ├── models/
│   │   ├── User.js              # Dashboard users
│   │   ├── App.js               # Deployed applications
│   │   ├── Database.js          # Managed databases
│   │   ├── Domain.js            # Custom domains
│   │   ├── Deployment.js        # Deployment history
│   │   └── Permission.js        # Sails Clearance permissions
│   ├── helpers/
│   │   ├── docker/              # Docker API helpers
│   │   ├── proxy/               # Caddy configuration
│   │   └── app/                 # App proxy helpers
│   └── policies/
├── assets/
│   ├── js/
│   │   ├── pages/               # Vue pages (Inertia)
│   │   ├── components/
│   │   └── layouts/
│   └── css/
├── config/
│   ├── datastores.js            # sails-sqlite
│   ├── routes.js
│   └── ...
├── views/                       # EJS templates
│
├── packages/
│   ├── cli/                     # npm: slipway (zero dependencies!)
│   │   ├── bin/
│   │   │   └── slipway.js       # Entry point
│   │   ├── src/
│   │   │   ├── commands/
│   │   │   │   ├── slide.js     # Deploy command
│   │   │   │   ├── app.js       # app:create, app:list, etc.
│   │   │   │   ├── db.js        # db:create, db:link, etc.
│   │   │   │   ├── domain.js    # domain:add, domain:list, etc.
│   │   │   │   ├── env.js       # env:set, env:list, etc.
│   │   │   │   ├── helm.js       # REPL connection
│   │   │   │   ├── logs.js      # Log streaming
│   │   │   │   └── dev.js       # Local dev mode
│   │   │   ├── lib/
│   │   │   │   ├── api.js       # Talk to Slipway server
│   │   │   │   ├── config.js    # ~/.slipway/config.json
│   │   │   │   └── colors.js    # ANSI color helpers
│   │   │   └── index.js
│   │   └── README.md
│   │
│   └── hook/                    # npm: sails-hook-slipway
│       ├── index.js             # Hook entry
│       ├── lib/
│       │   ├── bridge/          # /slipway/bridge routes
│       │   ├── helm/            # /slipway/helm routes
│       │   ├── quest/           # /slipway/quest (conditional)
│       │   ├── content/         # /slipway/content (conditional)
│       │   └── telemetry/       # OpenTelemetry
│       ├── views/               # Admin panel views
│       └── README.md
│
├── install.sh                   # VPS bootstrap script
├── Dockerfile                   # Builds the dashboard image
└── package.json                 # Workspace root with "workspaces" config
```

### Package Structure

| Package         | npm Name             | Purpose                                           |
| --------------- | -------------------- | ------------------------------------------------- |
| Root (`/`)      | (Docker image)       | The Slipway dashboard - manage apps from your VPS |
| `packages/cli`  | `slipway`            | CLI tool - `npx slipway slide`                    |
| `packages/hook` | `sails-hook-slipway` | Hook for Sails apps - Bridge, Helm, telemetry     |

### Dashboard Dependencies (root package.json)

```javascript
// package.json (root - the dashboard)
{
  "name": "@slipway/dashboard",
  "private": true,
  "dependencies": {
    // The Boring JavaScript Stack
    "sails": "^1.5.9",
    "sails-hook-orm": "^4.0.2",
    "sails-sqlite": "^1.0.0",          // Your SQLite adapter!
    "@inertiajs/vue3": "^1.0.0",
    "vue": "^3.4.0",
    "tailwindcss": "^3.4.0",

    // Docker control
    "dockerode": "^4.0.2",

    // OpenTelemetry (observability)
    "@opentelemetry/api": "^1.7.0",
    "@opentelemetry/sdk-node": "^0.46.0",
    "@opentelemetry/auto-instrumentations-node": "^0.40.0"
  }
}
```

### CLI Dependencies (packages/cli)

**Zero dependencies.** Uses only Node.js 22+ built-ins.

```javascript
// packages/cli/package.json
{
  "name": "slipway",
  "type": "module",
  "bin": {
    "slipway": "./bin/slipway.js"
  },
  "engines": {
    "node": ">=22.0.0"
  }
  // No dependencies!
}
```

**Usage:**

```bash
npx slipway login
npx slipway slide              # Deploy!
npx slipway app:list
npx slipway db:create mydb --type=postgres
npx slipway helm myapp
```

### Hook Dependencies (packages/hook)

```javascript
// packages/hook/package.json
{
  "name": "sails-hook-slipway",         // npm: sails-hook-slipway
  "sails": {
    "isHook": true,
    "hookName": "slipway"
  },
  "dependencies": {
    // OpenTelemetry for automatic instrumentation
    "@opentelemetry/api": "^1.7.0",
    "@opentelemetry/sdk-node": "^0.46.0",
    "@opentelemetry/exporter-otlp-http": "^0.46.0",

    // Admin panel UI (served from hook)
    "htmx.org": "^2.0.0"
  },
  "peerDependencies": {
    "sails": "^1.5.0",
    "sails-quest": "^1.0.0",            // Optional: queue integration
    "sails-content": "^1.0.0"           // Optional: CMS integration
  }
}
```

**What the hook provides:**

- `/slipway/bridge` - The Bridge (data management)
- `/slipway/helm` - The Helm (REPL)
- `/slipway/quest` - Quest dashboard (if sails-quest installed)
- `/slipway/content` - Content CMS (if sails-content installed)
- Automatic OpenTelemetry instrumentation → sends to Slipway server

---

## Two Ways to Access App Features

Users can access the Bridge, Helm, Quest, and Content in **two ways**:

### 1. Direct Access (via app URL)

```
myapp.example.com/slipway/bridge
myapp.example.com/slipway/helm
myapp.example.com/slipway/quest
myapp.example.com/slipway/content
```

- Requires separate authentication per app
- Good for content editors who only need one app

### 2. Via Slipway Dashboard (centralized)

```
slipway.yourdomain.com/app/myapp/bridge
slipway.yourdomain.com/app/myapp/helm
slipway.yourdomain.com/app/myapp/quest
slipway.yourdomain.com/app/myapp/content
```

- Single sign-on through Slipway Dashboard
- Dashboard proxies/embeds the app's control panel
- Good for developers managing multiple apps

### Dashboard App View

When you click an app in the Slipway Dashboard:

```
┌─────────────────────────────────────────────────────────────────────┐
│  slipway.yourdomain.com/app/myapp                                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  myapp.example.com                                        [Running]  │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  [Overview] [Bridge] [Helm] [Quest] [Content] [Logs] [Settings]    │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                                                               │   │
│  │   (Embedded Bridge / Helm / Quest / Content here)             │   │
│  │                                                               │   │
│  │   When "Bridge" tab is selected:                              │   │
│  │   - Shows models list                                         │   │
│  │   - CRUD interface                                            │   │
│  │   - All within the dashboard frame                            │   │
│  │                                                               │   │
│  │   When "Helm" tab is selected:                                │   │
│  │   - WebSocket REPL                                            │   │
│  │   - Run queries, call helpers                                 │   │
│  │                                                               │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### How the Proxy Works

The Slipway Dashboard acts as a secure gateway:

```javascript
// Dashboard routes
'GET /app/:appId/bridge/*': 'app/proxy-bridge',
'GET /app/:appId/helm': 'app/proxy-helm',
'GET /app/:appId/quest/*': 'app/proxy-quest',
'GET /app/:appId/content/*': 'app/proxy-content',

// The proxy controller:
// 1. Verifies user has permission for this app
// 2. Fetches app's internal URL from database
// 3. Forwards request to app's /slipway/* routes
// 4. Returns response (or establishes WebSocket for Helm)
```

### Permission Model (Sails Clearance)

Two levels of permissions work together:

**Dashboard Permissions** (who can access which apps):

```javascript
{
  // Global roles
  'superadmin': ['*'],                    // All apps, all features
  'developer': ['deploy', 'helm', 'bridge', 'logs'],

  // Per-app permissions
  'myapp:bridge': ['bridge', 'content'],    // Bridge + content for myapp only
  'myapp:support': ['bridge:read', 'logs']  // Read-only bridge, logs
}
```

**App-Level Permissions** (fine-grained data access):

```javascript
{
  'user:read': ['admin', 'support'],
  'user:write': ['admin'],
  'post:write': ['admin', 'editor'],
  'order:refund': ['admin']
}
```

This allows scenarios like:

- **Content Editor Sarah**: Can only access myapp's Content CMS
- **Support Mike**: Can view Bridge (read-only) across all apps
- **Developer Alex**: Full access to everything

---

## OpenTelemetry Integration

OpenTelemetry provides standardized observability - traces, metrics, logs.

### How It Works

```
┌─────────────────────┐         ┌─────────────────────┐
│   Your Sails App    │         │   Slipway Server    │
│                     │         │                     │
│  ┌───────────────┐  │  OTLP   │  ┌───────────────┐  │
│  │ sails-hook-   │──┼────────▶│  │  Telemetry    │  │
│  │ slipway       │  │         │  │  Collector    │  │
│  └───────────────┘  │         │  └───────┬───────┘  │
│                     │         │          │          │
│  Auto-instruments:  │         │          ▼          │
│  - HTTP requests    │         │  ┌───────────────┐  │
│  - Database queries │         │  │  Dashboard    │  │
│  - Sails actions    │         │  │  - Traces     │  │
│  - Quest jobs       │         │  │  - Metrics    │  │
│                     │         │  │  - Errors     │  │
└─────────────────────┘         │  └───────────────┘  │
                                └─────────────────────┘
```

### What Gets Collected

```javascript
// packages/hook/lib/telemetry/index.js
const { NodeSDK } = require('@opentelemetry/sdk-node')
const { OTLPTraceExporter } = require('@opentelemetry/exporter-otlp-http')
const {
  getNodeAutoInstrumentations
} = require('@opentelemetry/auto-instrumentations-node')

module.exports = function initTelemetry(sails) {
  const sdk = new NodeSDK({
    serviceName: sails.config.slipway?.appName || 'sails-app',
    traceExporter: new OTLPTraceExporter({
      url: `${sails.config.slipway.serverUrl}/v1/traces`
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // Auto-instrument everything
        '@opentelemetry/instrumentation-http': { enabled: true },
        '@opentelemetry/instrumentation-express': { enabled: true }
      })
    ]
  })

  sdk.start()

  // Custom Sails instrumentation
  instrumentWaterlineQueries(sails)
  instrumentSailsActions(sails)
  instrumentQuestJobs(sails)
}
```

### What You See in Dashboard

- **Request traces**: Every HTTP request with timing breakdown
- **Database queries**: All Waterline queries with duration
- **Slow query detection**: Queries over threshold highlighted
- **Error tracking**: Exceptions with full stack traces
- **Quest job traces**: Job execution with timing
- **Dependency map**: Which services talk to which

---

## Tunneling (Public URLs for Local Dev)

Expose your local Sails app to the internet for:

- Webhook testing (Stripe, GitHub, etc.)
- Sharing previews with clients
- Mobile device testing
- CI/CD preview deployments

### CLI Usage

```bash
# Tunnel local app to public URL
$ npx slipway tunnel

  ╭─────────────────────────────────────────────────────╮
  │                                                     │
  │   🚇 Tunnel Active                                  │
  │                                                     │
  │   Local:   http://localhost:1337                    │
  │   Public:  https://myapp-abc123.slipway.dev         │
  │                                                     │
  │   Press Ctrl+C to stop                              │
  │                                                     │
  ╰─────────────────────────────────────────────────────╯

# Or with custom subdomain (if you have Slipway Cloud)
$ npx slipway tunnel --subdomain=preview-feature-x
  Public:  https://preview-feature-x.slipway.dev
```

### Implementation Options

| Option                         | Pros                     | Cons                        |
| ------------------------------ | ------------------------ | --------------------------- |
| **localtunnel**                | Simple, npm package      | Unreliable, rate limits     |
| **Cloudflare Tunnel**          | Free, fast, reliable     | Requires cloudflared binary |
| **Self-hosted (bore/rathole)** | Full control             | More setup                  |
| **Slipway Tunnel Server**      | Integrated, branded URLs | Need to build/host          |

**Recommended**: Start with Cloudflare Tunnel integration, consider self-hosted later.

```javascript
// packages/cli/commands/tunnel.js
const { spawn } = require('child_process')

async function tunnel(port, options) {
  // Check if cloudflared is installed
  if (await hasCloudflared()) {
    // Use Cloudflare Tunnel (free, reliable)
    const proc = spawn('cloudflared', [
      'tunnel',
      '--url',
      `http://localhost:${port}`
    ])
    // Parse output for URL...
  } else {
    // Fall back to localtunnel
    const localtunnel = require('localtunnel')
    const tunnel = await localtunnel({ port })
    console.log(`Public URL: ${tunnel.url}`)
  }
}
```

---

## Sails Quest Integration

If the deployed app uses **sails-quest** for job queues:

### What Slipway Provides

```
┌─────────────────────────────────────────────────────────────┐
│  Quest Dashboard                                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Queues          Jobs Today    Failed    Processing          │
│  ─────────────────────────────────────────────────          │
│  emails          1,247         3         12                  │
│  notifications   892           0         5                   │
│  reports         156           1         2                   │
│                                                              │
│  Recent Failed Jobs                                          │
│  ─────────────────────────────────────────────────          │
│  │ ID      │ Queue  │ Error              │ Actions │         │
│  ├─────────┼────────┼────────────────────┼─────────┤         │
│  │ job-123 │ emails │ SMTP timeout       │ [Retry] │         │
│  │ job-456 │ reports│ PDF generation err │ [Retry] │         │
│                                                              │
│  Workers                                                     │
│  ─────────────────────────────────────────────────          │
│  worker-1: idle    worker-2: processing job-789             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Hook Integration

```javascript
// packages/hook/lib/quest/index.js
module.exports = function (sails) {
  // Check if sails-quest is installed
  if (!sails.hooks.quest) {
    return { routes: {} }
  }

  return {
    routes: {
      before: {
        'GET /slipway/quest': async (req, res) => {
          const stats = await sails.helpers.quest.getStats()
          const failed = await sails.helpers.quest.getFailedJobs()
          const workers = await sails.helpers.quest.getWorkers()

          res.view('slipway/quest', { stats, failed, workers })
        },

        'POST /slipway/quest/retry/:jobId': async (req, res) => {
          await sails.helpers.quest.retryJob(req.params.jobId)
          res.redirect('/slipway/quest')
        }
      }
    }
  }
}
```

---

## Sails Content Integration (CMS)

If the deployed app uses **sails-content**:

### What Slipway Provides

```
┌─────────────────────────────────────────────────────────────┐
│  Content Manager                                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Content Types                                               │
│  ─────────────────────────────────────────────────          │
│  📄 Posts (47)        📄 Pages (12)       📄 Products (89)   │
│                                                              │
│  Recent Content                                              │
│  ─────────────────────────────────────────────────          │
│  │ Title              │ Type    │ Status  │ Updated   │     │
│  ├────────────────────┼─────────┼─────────┼───────────┤     │
│  │ Welcome to our...  │ Post    │ Published│ 2h ago   │     │
│  │ About Us           │ Page    │ Draft   │ 1d ago    │     │
│  │ Product Launch     │ Post    │ Scheduled│ 3d ago   │     │
│                                                              │
│  Media Library (245 files)                                   │
│  ─────────────────────────────────────────────────          │
│  [Upload] [Browse]                                           │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Non-Technical User Experience

The CMS interface is designed for non-developers:

- Visual editor (no markdown required)
- Drag-and-drop media uploads
- Preview before publishing
- Scheduled publishing
- Version history

---

## install.sh (VPS Bootstrap)

One command to install Slipway on a fresh VPS:

```bash
curl -fsSL https://raw.githubusercontent.com/sailscastshq/slipway/main/install.sh | bash
```

### What It Does

```bash
#!/bin/bash
# install.sh

set -e

echo "🚀 Installing Slipway..."

# 1. Check/install Docker
if ! command -v docker &> /dev/null; then
    echo "📦 Installing Docker..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
fi

# 2. Create network for Slipway and apps
docker network create slipway 2>/dev/null || true

# 3. Generate secret
SLIPWAY_SECRET=$(openssl rand -hex 32)

# 4. Start Caddy (reverse proxy)
echo "🔒 Starting Caddy proxy..."
docker run -d \
  --name slipway-proxy \
  --network slipway \
  --restart unless-stopped \
  -p 80:80 \
  -p 443:443 \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v slipway-certs:/data \
  -e CADDY_INGRESS_NETWORKS=slipway \
  lucaslorentz/caddy-docker-proxy:latest

# 5. Start Slipway dashboard
echo "🚀 Starting Slipway dashboard..."
docker run -d \
  --name slipway \
  --network slipway \
  --restart unless-stopped \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v slipway-data:/app/data \
  -e SLIPWAY_SECRET=$SLIPWAY_SECRET \
  -l "caddy=:1337" \
  ghcr.io/sailscast/slipway:latest

# 6. Wait for startup
echo "⏳ Waiting for Slipway to start..."
sleep 5

# 7. Show access info
IP=$(curl -s ifconfig.me)
echo ""
echo "✅ Slipway installed successfully!"
echo ""
echo "   Dashboard: http://$IP:1337"
echo ""
echo "   Next steps:"
echo "   1. Point a domain to this server (e.g., slipway.yourdomain.com)"
echo "   2. Update the dashboard with: slipway setup"
echo "   3. SSL will be configured automatically"
echo ""
```

### Dockerfile

```dockerfile
# Dockerfile for Slipway dashboard
FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --production

# Copy application
COPY . .

# Slipway data directory
VOLUME /app/data

# Sails default port
EXPOSE 1337

# Health check
HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget --spider http://localhost:1337/health || exit 1

CMD ["node", "app.js"]
```

---

## Minimum Viable Slipway (What We Need First)

To deploy your 3 apps + databases + Redis from Coolify:

### Phase 0: MVP Checklist

```
Week 1-2: Core Infrastructure
├── [x] Monorepo setup (npm workspaces)
├── [x] packages/dashboard - Basic Sails app with sails-sqlite
├── [ ] packages/cli - Basic CLI structure
├── [ ] install.sh - VPS bootstrap
├── [x] Docker + Caddy setup
└── [x] User authentication (login/register)

Week 3-4: Git Integration (PRIORITY)
├── [ ] Git provider OAuth (GitHub first)
│   ├── [ ] GitHub App registration
│   ├── [ ] OAuth flow for user authentication
│   └── [ ] Installation flow for repo access
├── [ ] Deploy key management
│   ├── [ ] Generate SSH keypair per repo
│   ├── [ ] Add deploy key via GitHub API
│   └── [ ] Store encrypted private key
├── [ ] Webhook handling
│   ├── [ ] Webhook endpoint with signature verification
│   ├── [ ] Push event handling (trigger deploy)
│   ├── [ ] PR event handling (preview environments)
│   └── [ ] Delete event handling (cleanup previews)
├── [ ] Deploy tokens (CI/CD)
│   ├── [ ] Token generation with scoped permissions
│   ├── [ ] Token authentication middleware
│   └── [ ] Token management UI (create, revoke, audit)
└── [ ] Branch-to-environment mapping

Week 5-6: App Deployment
├── [ ] slipway app:create (with repo link)
├── [ ] Build worker
│   ├── [ ] Clone via deploy key
│   ├── [ ] Sails.js detection
│   ├── [ ] Dockerfile generation/detection
│   └── [ ] Docker image building with caching
├── [ ] Zero-downtime deployment
│   ├── [ ] Health check before switch
│   ├── [ ] Container replacement
│   └── [ ] Automatic rollback on failure
├── [ ] Environment variables
├── [ ] Custom domains + SSL
├── [ ] slipway logs (streaming)
└── [ ] Deployment history & rollback

Week 7-8: Database Services
├── [x] slipway db:create (postgres, mysql, redis, mongodb)
├── [x] Auto-inject DATABASE_URL on service link
├── [x] slipway db:connect (Dock SQL console)
├── [x] Database export/import
└── [ ] Automated backups

Week 9-10: CLI & Developer Experience
├── [ ] slipway login (OAuth flow)
├── [ ] slipway link (link local dir to app)
├── [ ] slipway slide (deploy)
│   ├── [ ] From linked Git repo
│   ├── [ ] Direct upload (no git)
│   └── [ ] With deploy token (CI/CD)
├── [ ] slipway logs (real-time streaming)
├── [ ] slipway env:set/get
└── [ ] slipway rollback

Week 11-12: Sails Native
├── [ ] packages/hook - Basic structure
├── [ ] Sails app auto-detection
├── [ ] slipway helm (REPL)
├── [ ] Bridge (model CRUD)
└── [ ] Quest dashboard (if detected)
```

### What's IN MVP (Git Integration Focus)

- ✅ **GitHub integration** (OAuth + GitHub App)
- ✅ **Push to deploy** (webhook-triggered)
- ✅ **PR preview environments** (auto-create, auto-destroy)
- ✅ **Deploy tokens** (for CI/CD pipelines)
- ✅ **Branch → Environment mapping**
- ✅ **CLI direct deploy** (without pushing to Git)

### What's NOT in MVP

- ❌ GitLab/Bitbucket integration (GitHub first, add later)
- ❌ Serverless deployment
- ❌ Slipway Cloud (managed offering)
- ❌ Full OpenTelemetry (basic metrics only)
- ❌ Sails Content CMS (later)
- ❌ Team collaboration (single user first)
- ❌ Multiple servers/clustering

### Resource Footprint

| Component      | Memory Target |
| -------------- | ------------- |
| Slipway Server | ~80MB         |
| Caddy          | ~40MB         |
| SQLite         | embedded      |
| **Total**      | **~120MB**    |

This is **7x lighter** than Coolify (~800MB-1GB).

### Dashboard Design System

Inspired by Linear and Resend:

- Dark mode first (with light mode option)
- Keyboard shortcuts everywhere
- Command palette (Cmd+K)
- Minimal chrome, maximum content
- Subtle animations
- Clean typography (Inter, JetBrains Mono)

### Command Palette (Raycast-Style)

A power-user feature inspired by Raycast, Linear, and VS Code. Press `Cmd+K` (Mac) or `Ctrl+K` (Windows/Linux) to access any action instantly.

#### User Experience

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ⌘K                                                                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ 🔍  Deploy to production...                                    ⌘D  │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  Recent                                                                  │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ 🚀  chieflevite / production          Deploy          ↵ to select │ │
│  │ 📊  chieflevite / Dock                Open                        │ │
│  │ 🔧  Settings / Global Env             Navigate                    │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  Actions                                                                 │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ 🚀  Deploy project...                                          ⌘D │ │
│  │ ↩️   Rollback deployment...                                    ⌘R │ │
│  │ 🔄  Restart service...                                         ⌘⇧R│ │
│  │ 📋  Copy connection string...                                     │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  Navigation                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ 📁  Go to project...                                           ⌘P │ │
│  │ ⚙️   Go to settings...                                         ⌘, │ │
│  │ 🗄️   Open Dock...                                                 │ │
│  │ 🌉  Open Bridge...                                                │ │
│  │ ⎈   Open Helm...                                                  │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ↑↓ Navigate  ↵ Select  ⎋ Close  ⌘⌫ Clear                              │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    COMMAND PALETTE ARCHITECTURE                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                     CommandPalette.vue                           │   │
│  │  • Modal overlay (Teleport to body)                             │   │
│  │  • Search input with debounce                                   │   │
│  │  • Keyboard navigation (↑↓↵⎋)                                   │   │
│  │  • Result grouping & rendering                                  │   │
│  └────────────────────────────────┬────────────────────────────────┘   │
│                                   │                                      │
│                                   ▼                                      │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                   useCommandPalette.js (Composable)              │   │
│  │                                                                  │   │
│  │  • isOpen: ref<boolean>                                         │   │
│  │  • query: ref<string>                                           │   │
│  │  • results: computed (filtered & ranked)                        │   │
│  │  • selectedIndex: ref<number>                                   │   │
│  │  • execute(command): void                                       │   │
│  │  • registerCommand(command): void                               │   │
│  │  • history: ref<Command[]>                                      │   │
│  └────────────────────────────────┬────────────────────────────────┘   │
│                                   │                                      │
│                                   ▼                                      │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                     Command Registry                             │   │
│  │                                                                  │   │
│  │  commands: Map<string, Command>                                 │   │
│  │                                                                  │   │
│  │  interface Command {                                            │   │
│  │    id: string                    // 'deploy.project'            │   │
│  │    title: string                 // 'Deploy project'            │   │
│  │    icon: string                  // '🚀' or component           │   │
│  │    keywords: string[]            // ['ship', 'push', 'release'] │   │
│  │    shortcut?: string             // '⌘D'                        │   │
│  │    group: string                 // 'actions' | 'navigation'    │   │
│  │    context?: () => boolean       // When to show this command   │   │
│  │    action: () => void | Promise  // What to execute             │   │
│  │    children?: () => Command[]    // Sub-commands (drill-down)   │   │
│  │  }                                                              │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Command Types

| Type             | Examples                      | Behavior                             |
| ---------------- | ----------------------------- | ------------------------------------ |
| **Actions**      | Deploy, Rollback, Restart     | Execute immediately or show sub-menu |
| **Navigation**   | Go to project, Open settings  | Router navigation                    |
| **Search**       | Find project, Find service    | Filter results as you type           |
| **Quick Access** | Recent projects, Pinned items | Show personalized results            |
| **Contextual**   | Copy DATABASE_URL (on Dock)   | Only shown in relevant context       |

#### Implementation

##### 1. Command Registry (`assets/js/composables/useCommandRegistry.js`)

```javascript
// Singleton command registry
const commands = new Map()
const history = useLocalStorage('slipway:command-history', [])

export function useCommandRegistry() {
  function register(command) {
    commands.set(command.id, {
      ...command,
      // Normalize keywords for search
      _searchText: [command.title, ...(command.keywords || [])]
        .join(' ')
        .toLowerCase()
    })
  }

  function unregister(id) {
    commands.delete(id)
  }

  function getAll(context = {}) {
    return Array.from(commands.values()).filter(
      (cmd) => !cmd.context || cmd.context(context)
    )
  }

  function execute(id, ...args) {
    const cmd = commands.get(id)
    if (cmd) {
      // Track in history
      history.value = [id, ...history.value.filter((h) => h !== id)].slice(
        0,
        10
      )
      return cmd.action(...args)
    }
  }

  return { register, unregister, getAll, execute, history }
}
```

##### 2. Fuzzy Search (`assets/js/lib/fuzzySearch.js`)

```javascript
/**
 * Fuzzy search with scoring
 * Inspired by fzf/Raycast ranking
 */
export function fuzzyMatch(query, text) {
  const queryLower = query.toLowerCase()
  const textLower = text.toLowerCase()

  let score = 0
  let queryIndex = 0
  let consecutiveMatches = 0
  let lastMatchIndex = -1

  for (let i = 0; i < textLower.length && queryIndex < queryLower.length; i++) {
    if (textLower[i] === queryLower[queryIndex]) {
      // Boost for consecutive matches
      if (lastMatchIndex === i - 1) {
        consecutiveMatches++
        score += 2 * consecutiveMatches
      } else {
        consecutiveMatches = 0
        score += 1
      }

      // Boost for word boundary matches
      if (i === 0 || text[i - 1] === ' ' || text[i - 1] === '/') {
        score += 5
      }

      // Boost for exact case match
      if (text[i] === query[queryIndex]) {
        score += 1
      }

      lastMatchIndex = i
      queryIndex++
    }
  }

  // All query chars must match
  if (queryIndex < queryLower.length) return null

  // Boost shorter matches (more relevant)
  score -= text.length * 0.1

  return { score, text }
}

export function fuzzySearch(query, items, getText) {
  if (!query) return items

  return items
    .map((item) => {
      const result = fuzzyMatch(query, getText(item))
      return result ? { item, score: result.score } : null
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.item)
}
```

##### 3. Command Palette Component (`assets/js/components/CommandPalette.vue`)

```vue
<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useCommandRegistry } from '@/composables/useCommandRegistry'
import { fuzzySearch } from '@/lib/fuzzySearch'

const router = useRouter()
const { getAll, execute, history } = useCommandRegistry()

const isOpen = ref(false)
const query = ref('')
const selectedIndex = ref(0)
const inputRef = ref(null)
const mode = ref('root') // 'root' | 'submenu'
const parentCommand = ref(null)

// Get commands based on current context
const currentContext = computed(() => ({
  route: router.currentRoute.value
  // Add more context as needed
}))

const allCommands = computed(() => getAll(currentContext.value))

// Filter and group results
const results = computed(() => {
  let cmds =
    mode.value === 'submenu' && parentCommand.value?.children
      ? parentCommand.value.children()
      : allCommands.value

  if (query.value) {
    cmds = fuzzySearch(query.value, cmds, (c) => c._searchText || c.title)
  }

  // Group by category
  const groups = {}

  // Add recent first if no query
  if (!query.value && mode.value === 'root') {
    const recent = history.value
      .map((id) => cmds.find((c) => c.id === id))
      .filter(Boolean)
      .slice(0, 3)

    if (recent.length) {
      groups['Recent'] = recent
    }
  }

  // Group remaining by their group property
  cmds.forEach((cmd) => {
    if (!query.value && history.value.includes(cmd.id)) return // Skip recent
    const group = cmd.group || 'Other'
    if (!groups[group]) groups[group] = []
    groups[group].push(cmd)
  })

  return groups
})

// Flat list for keyboard navigation
const flatResults = computed(() => Object.values(results.value).flat())

// Keyboard handling
function handleKeydown(e) {
  // Global: Open palette
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault()
    isOpen.value = !isOpen.value
    return
  }

  if (!isOpen.value) return

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault()
      selectedIndex.value = Math.min(
        selectedIndex.value + 1,
        flatResults.value.length - 1
      )
      break

    case 'ArrowUp':
      e.preventDefault()
      selectedIndex.value = Math.max(selectedIndex.value - 1, 0)
      break

    case 'Enter':
      e.preventDefault()
      const cmd = flatResults.value[selectedIndex.value]
      if (cmd) selectCommand(cmd)
      break

    case 'Escape':
      e.preventDefault()
      if (mode.value === 'submenu') {
        mode.value = 'root'
        parentCommand.value = null
        query.value = ''
      } else {
        isOpen.value = false
      }
      break

    case 'Backspace':
      if (!query.value && mode.value === 'submenu') {
        mode.value = 'root'
        parentCommand.value = null
      }
      break
  }
}

function selectCommand(cmd) {
  if (cmd.children) {
    // Drill down into submenu
    mode.value = 'submenu'
    parentCommand.value = cmd
    query.value = ''
    selectedIndex.value = 0
  } else {
    // Execute and close
    isOpen.value = false
    query.value = ''
    mode.value = 'root'
    execute(cmd.id)
  }
}

// Reset state when opening
watch(isOpen, (open) => {
  if (open) {
    query.value = ''
    selectedIndex.value = 0
    mode.value = 'root'
    parentCommand.value = null
    nextTick(() => inputRef.value?.focus())
  }
})

// Reset selection when results change
watch(query, () => {
  selectedIndex.value = 0
})

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="isOpen"
        class="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
        @click.self="isOpen = false"
      >
        <!-- Backdrop -->
        <div class="absolute inset-0 bg-black/50 backdrop-blur-sm" />

        <!-- Palette -->
        <div
          class="relative w-full max-w-xl rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900"
        >
          <!-- Search input -->
          <div
            class="flex items-center border-b border-gray-200 px-4 dark:border-gray-700"
          >
            <SearchIcon class="h-5 w-5 text-gray-400" />
            <input
              ref="inputRef"
              v-model="query"
              type="text"
              class="w-full bg-transparent px-3 py-4 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:text-white"
              :placeholder="
                mode === 'submenu'
                  ? parentCommand?.title
                  : 'Type a command or search...'
              "
            />
            <kbd
              class="hidden rounded bg-gray-100 px-2 py-1 text-xs text-gray-500 dark:bg-gray-800 sm:inline"
            >
              esc
            </kbd>
          </div>

          <!-- Results -->
          <div class="max-h-80 overflow-y-auto p-2">
            <template v-for="(commands, group) in results" :key="group">
              <div
                class="px-2 py-1.5 text-xs font-medium text-gray-500 dark:text-gray-400"
              >
                {{ group }}
              </div>
              <button
                v-for="(cmd, i) in commands"
                :key="cmd.id"
                @click="selectCommand(cmd)"
                @mouseenter="selectedIndex = flatResults.indexOf(cmd)"
                :class="[
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm',
                  flatResults.indexOf(cmd) === selectedIndex
                    ? 'bg-gray-100 dark:bg-gray-800'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                ]"
              >
                <span class="text-lg">{{ cmd.icon }}</span>
                <span class="flex-1 text-gray-900 dark:text-white">{{
                  cmd.title
                }}</span>
                <kbd v-if="cmd.shortcut" class="text-xs text-gray-400">{{
                  cmd.shortcut
                }}</kbd>
                <ChevronRightIcon
                  v-if="cmd.children"
                  class="h-4 w-4 text-gray-400"
                />
              </button>
            </template>

            <!-- Empty state -->
            <div
              v-if="!flatResults.length"
              class="py-8 text-center text-sm text-gray-500"
            >
              No commands found for "{{ query }}"
            </div>
          </div>

          <!-- Footer -->
          <div
            class="flex items-center justify-between border-t border-gray-200 px-4 py-2 text-xs text-gray-500 dark:border-gray-700"
          >
            <div class="flex gap-2">
              <span><kbd>↑↓</kbd> Navigate</span>
              <span><kbd>↵</kbd> Select</span>
              <span><kbd>esc</kbd> Close</span>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
```

##### 4. Registering Commands (`assets/js/commands/index.js`)

```javascript
import { useCommandRegistry } from '@/composables/useCommandRegistry'
import { router } from '@/router'

export function registerCoreCommands() {
  const { register } = useCommandRegistry()

  // === Navigation Commands ===

  register({
    id: 'nav.projects',
    title: 'Go to Projects',
    icon: '📁',
    keywords: ['dashboard', 'home', 'apps'],
    shortcut: '⌘P',
    group: 'Navigation',
    action: () => router.push('/')
  })

  register({
    id: 'nav.settings',
    title: 'Go to Settings',
    icon: '⚙️',
    keywords: ['preferences', 'config'],
    shortcut: '⌘,',
    group: 'Navigation',
    action: () => router.push('/settings')
  })

  register({
    id: 'nav.settings.git',
    title: 'Git Settings',
    icon: '🔗',
    keywords: ['github', 'gitlab', 'repository'],
    group: 'Navigation',
    action: () => router.push('/settings/git')
  })

  register({
    id: 'nav.settings.env',
    title: 'Global Environment Variables',
    icon: '🌍',
    keywords: ['env', 'variables', 'secrets'],
    group: 'Navigation',
    action: () => router.push('/settings/global-env')
  })

  // === Action Commands ===

  register({
    id: 'action.deploy',
    title: 'Deploy project...',
    icon: '🚀',
    keywords: ['ship', 'push', 'release', 'slide'],
    shortcut: '⌘D',
    group: 'Actions',
    // Show submenu of projects/environments
    children: () => getDeployableEnvironments()
  })

  register({
    id: 'action.rollback',
    title: 'Rollback deployment...',
    icon: '↩️',
    keywords: ['revert', 'undo'],
    shortcut: '⌘R',
    group: 'Actions',
    children: () => getRollbackOptions()
  })

  // === Contextual Commands (shown only in relevant context) ===

  register({
    id: 'context.copy-db-url',
    title: 'Copy DATABASE_URL',
    icon: '📋',
    keywords: ['connection', 'string', 'postgres'],
    group: 'Quick Actions',
    context: (ctx) => ctx.route.path.includes('/dock'),
    action: () => copyDatabaseUrl()
  })

  register({
    id: 'context.open-logs',
    title: 'View Logs',
    icon: '📜',
    keywords: ['output', 'console', 'debug'],
    group: 'Quick Actions',
    context: (ctx) => ctx.route.path.includes('/projects/'),
    action: () => openLogsPanel()
  })
}

// Dynamic command generators
function getDeployableEnvironments() {
  // Fetch from store or API
  return projects.value.flatMap((project) =>
    project.environments.map((env) => ({
      id: `deploy.${project.slug}.${env.slug}`,
      title: `${project.name} / ${env.name}`,
      icon: env.slug === 'production' ? '🔴' : '🟡',
      action: () => triggerDeploy(project.slug, env.slug)
    }))
  )
}
```

#### Keyboard Shortcuts

| Shortcut        | Action                               |
| --------------- | ------------------------------------ |
| `⌘K` / `Ctrl+K` | Open command palette                 |
| `⌘D`            | Deploy (opens project selector)      |
| `⌘R`            | Rollback (opens deployment selector) |
| `⌘P`            | Go to project                        |
| `⌘,`            | Open settings                        |
| `⌘⇧R`           | Restart service                      |
| `⌘.`            | Quick actions menu                   |
| `↑↓`            | Navigate results                     |
| `↵`             | Execute selected                     |
| `⎋`             | Close / Go back                      |
| `⌘⌫`            | Clear search                         |

#### Advanced Features

##### 1. Nested Commands (Drill-Down)

```javascript
register({
  id: 'action.service',
  title: 'Service actions...',
  icon: '🔧',
  group: 'Actions',
  children: () => [
    {
      id: 'service.restart',
      title: 'Restart',
      icon: '🔄',
      action: restartService
    },
    { id: 'service.stop', title: 'Stop', icon: '⏹️', action: stopService },
    { id: 'service.logs', title: 'View Logs', icon: '📜', action: viewLogs },
    { id: 'service.shell', title: 'Open Shell', icon: '💻', action: openShell }
  ]
})
```

##### 2. Dynamic Search Results

```javascript
register({
  id: 'search.projects',
  title: 'Search projects...',
  icon: '🔍',
  group: 'Search',
  // Async children - fetched as user types
  children: async (query) => {
    const projects = await searchProjects(query)
    return projects.map((p) => ({
      id: `project.${p.id}`,
      title: p.name,
      icon: '📁',
      action: () => router.push(`/projects/${p.slug}`)
    }))
  }
})
```

##### 3. Recent & Pinned

```javascript
// Track command usage
const commandHistory = useLocalStorage('slipway:cmd-history', [])
const pinnedCommands = useLocalStorage('slipway:cmd-pinned', [])

// Show at top of results
const recentCommands = computed(() =>
  commandHistory.value.slice(0, 5).map((id) => commands.get(id))
)
```

##### 4. Theme Integration

The command palette follows the app's dark/light mode automatically and uses the same design tokens for consistency.

---

## Installation

### Method 1: One-Line Install (Recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/sailscastshq/slipway/main/install.sh | bash
```

This will:

1. Check system requirements (Docker, Node.js)
2. Download Slipway
3. Run initial setup wizard
4. Start Slipway on port 3000

### Method 2: Docker Compose

```yaml
# docker-compose.yml
version: '3.8'
services:
  slipway:
    image: slipway/slipway:latest
    ports:
      - '3000:1337'
      - '443:443'
      - '80:80'
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - slipway_data:/data
    environment:
      - SLIPWAY_SECRET=your-secret-key
      - SLIPWAY_DOMAIN=slipway.yourdomain.com

volumes:
  slipway_data:
```

```bash
docker-compose up -d
```

### Method 3: NPM Global Install

```bash
npm install -g @slipway/cli
slipway init
slipway start
```

### Method 4: Manual Installation

```bash
git clone https://github.com/slipway-dev/slipway.git
cd slipway
npm install
cp .env.example .env
npm run setup
npm start
```

### Post-Installation

1. Access Slipway at `http://localhost:1337` (or your configured domain)
2. Create admin account
3. Connect Git provider (GitHub, GitLab, Bitbucket)
4. Deploy first application

### System Requirements

**Minimum:**

- 1 CPU core
- 1GB RAM
- 10GB disk space
- Docker 20.10+
- Node.js 18+ (for CLI)

**Recommended:**

- 2+ CPU cores
- 4GB+ RAM
- 50GB+ SSD
- Docker 24+

---

## The Acid Test

### Migration from Coolify

The true test of Slipway's viability: **migrate three production Sails applications, their databases, and Redis instances from Coolify to Slipway** and have it feel native.

#### Current Setup (Coolify)

- 3 Sails.js fullstack applications
- PostgreSQL database
- Redis instance
- Custom domains with SSL

#### Migration Goals

| Requirement         | How Slipway Handles It                                        |
| ------------------- | ------------------------------------------------------------- |
| Deploy 3 Sails apps | Git integration, auto-detect Sails, configure environment     |
| PostgreSQL database | Database provisioning, import data, update connection strings |
| Redis instance      | Redis container, session/cache configuration                  |
| Custom domains      | Domain configuration, automatic SSL                           |
| Zero downtime       | Blue-green deployment during migration                        |

#### What Makes It Feel "Sails Native"

1. **Auto-Detection**

   - Slipway sees `package.json` → detects Sails
   - Reads `config/datastores.js` → knows database config
   - Finds `api/models/` → can generate admin panel

2. **Integrated Helm**

   - Click "Helm" → get a REPL connected to the app
   - Run `await User.find()` → see results
   - Like having Guppy built into the platform

3. **Quest Integration**

   - If app uses Sails Quest, queue dashboard appears
   - See job status, retry failed jobs, monitor workers

4. **Content Detection**

   - If Sails Content is present, CMS interface enables
   - Manage content without separate CMS deploy

5. **Model-Aware Bridge**
   - Bridge auto-generated from Sails models
   - Relationships understood (User hasMany Posts)
   - No configuration needed—just works

#### Migration Steps

```bash
# 1. Install Slipway on target server
curl -fsSL https://raw.githubusercontent.com/sailscastshq/slipway/main/install.sh | bash

# 2. Connect Git provider
slipway git connect github

# 3. Import existing databases
slipway db import --from=coolify --type=postgres
slipway db import --from=coolify --type=redis

# 4. Deploy applications (slide them into production!)
slipway slide github.com/user/app1 --env=production
slipway slide github.com/user/app2 --env=production
slipway slide github.com/user/app3 --env=production

# 5. Configure domains
slipway domain add app1.example.com --app=app1
slipway domain add app2.example.com --app=app2
slipway domain add app3.example.com --app=app3

# 6. Switch DNS
# Update DNS records to point to Slipway server

# 7. Verify
slipway helm app1
> await User.count()
42
```

---

## Market Analysis

### Will People Move to Slipway?

#### Target Audience

1. **Sails.js Developers** - Primary audience

   - Estimated community: 10,000-50,000 active developers
   - Pain point: No integrated deployment solution
   - Currently using: Coolify, Dokploy, manual Docker, Heroku, Railway

2. **The Boring JavaScript Stack Users**

   - Growing community around Vue/React + Inertia + Sails
   - Values simplicity over complexity
   - Likely early adopters

3. **Node.js Teams Seeking Simplicity**
   - Teams tired of Kubernetes complexity
   - Want Laravel-like developer experience
   - Value convention over configuration

#### Why They Would Move

| Reason                                          | Weight |
| ----------------------------------------------- | ------ |
| Sails-native understanding (REPL, models, etc.) | ★★★★★  |
| Integrated Bridge (no separate setup)           | ★★★★☆  |
| All-in-one solution (deploy + monitor + admin)  | ★★★★☆  |
| Lighter than Coolify                            | ★★★☆☆  |
| Beautiful, modern dashboard                     | ★★★☆☆  |
| Open source, self-hostable                      | ★★★★☆  |

#### Why They Might Not Move

| Concern                     | Mitigation                                    |
| --------------------------- | --------------------------------------------- |
| New project, unproven       | Focus on stability, clear roadmap             |
| Fear of vendor lock-in      | Open source, standard Docker containers       |
| Already invested in Coolify | Migration tools, clear benefits documentation |
| Learning curve              | Excellent documentation, familiar patterns    |

#### Market Opportunity

The Node.js deployment market is fragmented:

- **Generic platforms** (Coolify, Dokploy) - Not framework-aware
- **PaaS providers** (Railway, Render) - Limited control
- **Enterprise** (Kubernetes) - Too complex for small teams

**Gap**: No Sails-native deployment platform exists.

Laravel has Forge/Vapor, Rails has Hatchbox, Django has... not much.
**Sails deserves Slipway.**

---

## Feasibility & AI-Assisted Development

### Can One Developer Build This?

#### Complexity Assessment

| Component               | Complexity | Estimated Effort |
| ----------------------- | ---------- | ---------------- |
| Core deployment engine  | High       | Major            |
| Database management     | Medium     | Moderate         |
| Proxy/SSL configuration | Medium     | Moderate         |
| Sails REPL (Helm)       | High       | Major            |
| Bridge generator        | High       | Major            |
| Monitoring & metrics    | Medium     | Moderate         |
| Error tracking          | Medium     | Moderate         |
| Dashboard UI            | Medium     | Moderate         |
| CLI tool                | Low        | Minor            |
| Documentation           | Medium     | Ongoing          |

**Total Assessment**: This is a **significant** project, comparable to building Coolify itself.

### AI-Assisted Development Advantages

With AI coding assistants (Claude, Cursor, Copilot), productivity is greatly amplified:

| Task                                 | AI Assistance Level |
| ------------------------------------ | ------------------- |
| Boilerplate generation               | ★★★★★               |
| API endpoint creation                | ★★★★★               |
| UI component building                | ★★★★☆               |
| Docker configuration                 | ★★★★☆               |
| Test writing                         | ★★★★☆               |
| Documentation                        | ★★★★★               |
| Complex algorithms (REPL sandboxing) | ★★★☆☆               |
| System architecture                  | ★★★☆☆               |

### Recommended Approach

#### Phase 1: MVP (Core Deployment)

- Git-based deployment
- Basic database provisioning
- Caddy integration
- Simple dashboard

#### Phase 2: Sails Intelligence

- Sails app detection
- Basic Helm (REPL)
- Model introspection

#### Phase 3: The Bridge

- Auto-generated CRUD
- Basic field types
- Relationship handling

#### Phase 4: Observability

- Log aggregation
- Basic metrics
- Error capture

#### Phase 5: Polish & Cloud

- Beautiful dashboard
- Advanced features
- Slipway Cloud offering

### Leveraging Open Source

Don't reinvent wheels:

- **Caddy** - Reverse proxy with automatic HTTPS
- **Litestream** - SQLite replication
- **Sentry SDK patterns** - Error tracking approach
- **AdminJS concepts** - Bridge patterns
- **Coolify's approach** - Learn from their architecture

### Time Investment Reality

With focused effort and AI assistance:

- **MVP**: 2-3 months of dedicated work
- **Usable v1.0**: 6-9 months
- **Feature parity with vision**: 12-18 months

**Key success factor**: Start small, ship often, iterate based on feedback.

---

## Competitive Analysis

### Comparison Matrix

| Feature                | Coolify   | Dokku         | Kamal        | Slipway       |
| ---------------------- | --------- | ------------- | ------------ | ------------- |
| **Focus**              | Generic   | Generic       | Rails-first  | Sails-native  |
| **Open Source**        | ✅        | ✅            | ✅           | ✅            |
| **Self-Hosted**        | ✅        | ✅            | ✅           | ✅            |
| **Web Dashboard**      | ✅        | ❌ (Pro only) | ❌           | ✅            |
| **CLI**                | Basic     | ✅ Excellent  | ✅ Excellent | ✅ Excellent  |
| **Git Push Deploy**    | ✅        | ✅            | ❌           | ✅            |
| **Config File**        | ❌        | ❌            | ✅           | ✅            |
| **Service Linking**    | Manual    | ✅ Auto       | Manual       | ✅ Auto       |
| **Bridge**             | ❌        | ❌            | ❌           | ✅ Integrated |
| **Framework REPL**     | ❌        | ❌            | `exec` only  | ✅ Sails Helm |
| **Dev Mode**           | ❌        | ❌            | ❌           | ✅            |
| **Queue Dashboard**    | ❌        | ❌            | ❌           | ✅ Quest      |
| **Transparent Docker** | ❌ Hidden | ❌ Hidden     | ✅           | ✅            |
| **Resource Usage**     | Heavy     | Light         | Light        | Light (goal)  |

### Coolify

| Aspect              | Coolify           | Slipway                  |
| ------------------- | ----------------- | ------------------------ |
| Focus               | Generic (any app) | Sails-native             |
| Bridge              | None built-in     | Integrated               |
| REPL                | None              | Sails Helm               |
| Framework awareness | None              | Deep Sails integration   |
| Resource usage      | Higher (~1GB RAM) | Lighter (goal: <256MB)   |
| Maturity            | Established       | New                      |
| Dashboard           | Good              | Better (Linear-inspired) |
| Docker visibility   | Hidden            | Transparent              |

### Dokku

| Aspect          | Dokku                    | Slipway                  |
| --------------- | ------------------------ | ------------------------ |
| CLI Design      | ✅ Excellent (noun:verb) | ✅ Adopting this pattern |
| Git Push        | ✅ Native                | ✅ Supported             |
| Service Linking | ✅ Auto DATABASE_URL     | ✅ Adopting this         |
| Plugin System   | ✅ Extensible            | ✅ (future)              |
| Web Dashboard   | ❌ (Pro only)            | ✅ Built-in              |
| Bridge          | ❌                       | ✅                       |
| Framework REPL  | ❌                       | ✅ Sails Helm            |

### Kamal

| Aspect        | Kamal                       | Slipway              |
| ------------- | --------------------------- | -------------------- |
| Config File   | ✅ deploy.yml               | ✅ config/slipway.js |
| Transparency  | ✅ Shows Docker commands    | ✅ Adopting this     |
| Accessories   | ✅ Databases as accessories | ✅ Adopting this     |
| Web Dashboard | ❌ CLI only                 | ✅ Built-in          |
| Dev Mode      | ❌                          | ✅ Local companion   |
| Framework     | Rails-focused               | Sails-native         |

### Dokploy

| Aspect | Dokploy | Slipway       |
| ------ | ------- | ------------- |
| Focus  | Generic | Sails-native  |
| UI     | Good    | Better (goal) |
| Bridge | None    | Integrated    |
| REPL   | None    | Sails Helm    |

### Railway/Render

| Aspect              | Railway/Render | Slipway                |
| ------------------- | -------------- | ---------------------- |
| Self-hosted         | No             | Yes                    |
| Pricing             | Pay per use    | Free (self-hosted)     |
| Framework awareness | Limited        | Deep Sails integration |
| Data ownership      | Their servers  | Your servers           |
| Dev mode            | ❌             | ✅                     |

### Laravel Forge

| Aspect      | Laravel Forge     | Slipway           |
| ----------- | ----------------- | ----------------- |
| Framework   | Laravel           | Sails             |
| Open source | No                | Yes               |
| Self-hosted | No                | Yes               |
| Pricing     | $19-39/month      | Free              |
| Bridge      | Separate (Nova)   | Integrated        |
| REPL        | Tinker (separate) | Helm (integrated) |

### What Slipway Uniquely Offers

1. **Dev Mode Companion** - No other tool works locally during development
2. **Integrated Bridge** - Nova-like experience without separate setup
3. **Sails Helm** - Framework-aware REPL, not just `docker exec`
4. **Quest Integration** - Queue dashboard built-in
5. **Beautiful Dashboard** - Linear/Resend quality (not an afterthought)
6. **Best of Both Worlds** - Kamal's transparency + Dokku's elegance

---

## Roadmap

### Phase 1: Foundation (v0.1)

- [x] Project research and planning
- [ ] Monorepo structure setup
- [ ] Core Sails application scaffolding
- [ ] Basic authentication system
- [ ] Dashboard layout (Linear/Resend inspired)
- [ ] Git integration (GitHub first)
- [ ] Basic Docker deployment engine

### Phase 2: Core Deployment (v0.2)

- [ ] Application deployment pipeline
- [ ] Environment variable management
- [ ] Caddy integration for routing
- [ ] SSL/TLS automation (Let's Encrypt)
- [ ] Custom domain configuration
- [ ] Basic deployment logs

### Phase 3: Database Layer (v0.3)

- [ ] PostgreSQL provisioning
- [ ] MySQL provisioning
- [ ] SQLite support
- [ ] Redis provisioning
- [ ] Database backup system
- [ ] Connection management

### Phase 4: Sails Intelligence (v0.4)

- [ ] Sails app auto-detection
- [ ] Sails Helm (REPL) - MVP
- [ ] Model introspection
- [ ] Config reading
- [ ] Lifecycle awareness

### Phase 5: The Bridge (v0.5)

- [ ] Model-based CRUD generation
- [ ] Field type handling
- [ ] List views with filtering
- [ ] Relationship management
- [ ] Basic permissions

### Phase 6: Observability (v0.6)

- [ ] Log aggregation
- [ ] Basic metrics collection
- [ ] Error capture
- [ ] Health monitoring
- [ ] Uptime checks

### Phase 7: Queue Management (v0.7)

- [ ] Sails Quest integration
- [ ] Job dashboard
- [ ] Retry functionality
- [ ] Worker monitoring

### Phase 8: Polish (v0.8)

- [ ] Dashboard design refinement
- [ ] Keyboard shortcuts
- [ ] Command palette
- [ ] Notifications system
- [ ] Team collaboration

### Phase 9: CMS Integration (v0.9)

- [ ] Sails Content detection
- [ ] Content management interface
- [ ] Media library

### Phase 10: Production Ready (v1.0)

- [ ] Security audit
- [ ] Performance optimization
- [ ] Documentation complete
- [ ] Migration tools
- [ ] Community launch

### Future: Slipway Cloud (v2.0+)

- [ ] Managed hosting offering
- [ ] Multi-region deployment
- [ ] Enhanced analytics
- [ ] Premium support

---

## Self-Update Mechanism

Since Slipway is self-hosted via Docker, users need a way to know when updates are available and how to apply them.

### Version Checking

The dashboard periodically checks for updates:

```javascript
// api/helpers/check-for-updates.js
module.exports = {
  fn: async function () {
    const currentVersion = sails.config.slipway.version

    // Check GitHub releases API (no auth needed for public repo)
    const response = await fetch(
      'https://api.github.com/repos/sailscastshq/slipway/releases/latest'
    )
    const latest = await response.json()

    return {
      currentVersion,
      latestVersion: latest.tag_name,
      updateAvailable: semver.gt(latest.tag_name, currentVersion),
      releaseNotes: latest.body,
      releaseUrl: latest.html_url
    }
  }
}
```

### Update Notification Banner

When an update is available, show a non-intrusive banner:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ✨ Slipway v1.2.0 is available (you're on v1.1.3)                       │
│     [View Release Notes]  [Update Now]  [Remind Me Later]  [×]          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Update Methods

#### 1. One-Click Update (Dashboard)

The dashboard can trigger its own update:

```javascript
// api/controllers/system/update.js
module.exports = {
  fn: async function () {
    // 1. Pull latest image
    await sails.helpers.docker.pullImage('ghcr.io/sailscastshq/slipway:latest')

    // 2. Signal the container orchestrator to restart with new image
    // This is done via a sidecar or Docker socket
    await sails.helpers.docker.recreateContainer('slipway')

    // The response won't reach the client since we're restarting,
    // but the frontend handles this gracefully
    return { updating: true }
  }
}
```

#### 2. CLI Update

```bash
# Check for updates
$ slipway system:update --check
  Current: v1.1.3
  Latest:  v1.2.0
  Update available!

# Apply update
$ slipway system:update
  Pulling ghcr.io/sailscastshq/slipway:latest...
  Stopping current container...
  Starting new container...
  ✓ Updated to v1.2.0

# Or manually via Docker
$ docker pull ghcr.io/sailscastshq/slipway:latest
$ docker-compose up -d
```

#### 3. Automatic Updates (Optional)

Users can enable automatic updates in settings:

```javascript
// config/slipway.js
module.exports.slipway = {
  updates: {
    autoCheck: true, // Check for updates daily
    autoUpdate: false, // Don't auto-update by default (opt-in)
    channel: 'stable', // 'stable' | 'beta' | 'nightly'
    notifyOnly: true // Just show banner, don't auto-update
  }
}
```

### Graceful Restart During Update

To avoid disrupting users during update:

1. **Health Check Grace Period**: New container must pass health checks before old one is stopped
2. **Session Persistence**: Sessions stored in Redis/SQLite survive restarts
3. **WebSocket Reconnection**: Frontend auto-reconnects WebSockets after restart
4. **Inertia Version**: Forces page reload to get new frontend assets

```javascript
// The Inertia version changes with each release
// This forces clients to reload and get fresh assets
app.use(
  inertia({
    version: () => sails.config.slipway.version
  })
)
```

### Changelog & Migration Notes

For breaking changes, show migration requirements before update:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ⚠️  Slipway v2.0.0 requires migration                                   │
│                                                                          │
│  Breaking changes:                                                       │
│  • Database schema updated (auto-migrates on restart)                   │
│  • config/slipway.js format changed (see migration guide)               │
│                                                                          │
│  [View Migration Guide]  [Update Anyway]  [Cancel]                      │
└─────────────────────────────────────────────────────────────────────────┘
```

### Version Pinning

For production stability, users can pin to specific versions:

```yaml
# docker-compose.yml
services:
  slipway:
    image: ghcr.io/sailscastshq/slipway:1.2.0  # Pinned version
    # or
    image: ghcr.io/sailscastshq/slipway:latest  # Always latest
    # or
    image: ghcr.io/sailscastshq/slipway:1.x     # Latest 1.x patch
```

---

## Open Questions

### Technical Decisions

1. **Container Orchestration**: Docker Compose vs custom orchestration?
2. **Reverse Proxy**: ✅ Caddy (decided) - simpler config, automatic HTTPS
3. **REPL Sandboxing**: How to safely execute user commands?
4. **Multi-tenancy**: How to handle multiple Slipway users/teams?
5. **Scaling**: When/how to support multi-node Slipway clusters?

### Product Decisions

1. **Serverless Priority**: How important is serverless Sails support?
2. **Cloud Offering**: When to launch managed cloud?
3. **Pricing Model**: Open core? Donations? Paid cloud only?
4. **Plugins/Extensions**: Should Slipway be extensible?

### Community

1. **Governance**: How to manage open source contributions?
2. **Documentation**: Docusaurus? GitBook? Custom?
3. **Community Platform**: Discord? GitHub Discussions?

---

## Appendix A: Name Rationale

### Why "Slipway"?

A **slipway** is a ramp that slopes into water, used for:

- **Building ships** - Where ships are constructed
- **Launching ships** - Ships slide into the water
- **Maintenance** - Ships are pulled up for repairs

This perfectly captures the deployment platform concept:

- **Build** - Your app is prepared
- **Launch** - Slides smoothly into production
- **Maintain** - Monitor, update, manage

The name is:

- **Nautical** - Fits with Sails.js theming
- **Memorable** - Unique, not commonly used in tech
- **Evocative** - Implies smooth, effortless deployment
- **Searchable** - No major conflicts

---

## Appendix B: Dashboard Design Inspiration

### Linear

- Keyboard-first navigation
- Clean sidebar
- Subtle animations
- Dark theme excellence

### Resend

- Developer-focused simplicity
- Clear information hierarchy
- Beautiful typography
- Functional minimalism

### Vercel

- Deployment-focused UI
- Real-time logs
- Environment management
- Git integration UI

### Target Aesthetic

- **Dark mode** default (light mode option)
- **Inter** for UI text
- **JetBrains Mono** for code
- **Subtle gradients** for cards
- **Keyboard shortcuts** everywhere
- **Command palette** (Cmd+K)
- **Minimal borders**, shadow-based depth
- **Smooth animations** (not distracting)

### Slide-to-Deploy Button UX

The deploy action uses a **slide-to-deploy** interaction instead of a traditional click button. This reinforces the "slide into production" brand and prevents accidental deploys.

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│  Ready to deploy?                                   │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │ ◉ Deploy ═══════════════════════════▶│      │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  Slide right to deploy to production                │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Interaction Flow:**

1. **Initial State**: A slider handle with "Deploy" text sits on the left
2. **Drag**: User drags the handle to the right (like unlocking a phone)
3. **Threshold**: At ~80% travel, the action is confirmed
4. **Feedback**:
   - Track fills with Vue green (#42b883) as you slide
   - Haptic feedback on mobile
   - Sound effect option (subtle "whoosh")
5. **Release Before Threshold**: Slider snaps back, no action
6. **Complete**:
   - Slider transforms into progress indicator
   - "Sliding into production..." message
   - Confetti or subtle celebration on success

**Why Slide Instead of Click:**

| Benefit                 | Description                            |
| ----------------------- | -------------------------------------- |
| **Prevents accidents**  | Can't misclick a production deploy     |
| **Intentional action**  | Requires deliberate physical gesture   |
| **Brand reinforcement** | "Slide" = Slipway's core metaphor      |
| **Satisfying UX**       | Tactile, game-like, memorable          |
| **Mobile-friendly**     | Natural swipe gesture on touch devices |

**Variations:**

- **Staging**: Shorter slide distance, green track
- **Production**: Full slide distance, amber/orange track
- **Rollback**: Slide left instead of right, red track

**Keyboard Alternative:**

For keyboard users, `Cmd+Shift+D` opens a confirmation dialog:

```
┌────────────────────────────────────────┐
│  Deploy to production?                 │
│                                        │
│  Type "deploy" to confirm:             │
│  ┌────────────────────────────────┐   │
│  │                                │   │
│  └────────────────────────────────┘   │
│                                        │
│  [Cancel]                              │
└────────────────────────────────────────┘
```

---

## Appendix C: Helm (REPL) Examples

```javascript
// Connect to app's environment
slipway helm my-app

// Query models
> await User.find({ role: 'admin' })
[
  { id: 1, email: 'admin@example.com', role: 'admin' },
  { id: 2, email: 'super@example.com', role: 'admin' }
]

// Count records
> await Post.count()
1247

// Use helpers
> await sails.helpers.email.send({ to: 'test@example.com', subject: 'Test' })
{ success: true, messageId: 'abc123' }

// Check config
> sails.config.custom.stripeKey
'sk_live_xxx...'

// Execute actions (with caution)
> await sails.helpers.payments.processRefund({ orderId: 123 })
{ refunded: true, amount: 49.99 }

// Table output
> await User.find().limit(5).meta({ format: 'table' })
┌────┬──────────────────┬───────────┬────────────────────┐
│ id │ email            │ role      │ createdAt          │
├────┼──────────────────┼───────────┼────────────────────┤
│ 1  │ admin@example.   │ admin     │ 2024-01-15T10:30   │
│ 2  │ user@example.com │ user      │ 2024-01-16T14:22   │
│ 3  │ dev@example.com  │ developer │ 2024-01-17T09:15   │
└────┴──────────────────┴───────────┴────────────────────┘
```

---

## Slipway Lookout — Unified Application Observability

### The Name: Lookout

On a ship, the **lookout** is the crew member stationed in the crow's nest — the highest vantage point — watching for danger, obstacles, and opportunities on the horizon. They see everything: weather patterns, approaching vessels, shallow water, and coastline. The lookout doesn't just see one thing — they see the _whole picture_ from a position of advantage.

**Slipway Lookout** = Laravel Nightwatch + Laravel Pulse, unified in one self-hosted, Sails-native observability platform.

- **Nightwatch** = deep event-level tracing, error tracking, request timelines, team collaboration
- **Pulse** = real-time dashboard with server stats, slow queries, queue throughput, cache performance
- **Lookout** = both, in one view, self-hosted, free, built for Sails.js

> "The Lookout sees everything your app does — from the crow's nest."

### What Laravel Has (Two Separate Products)

Laravel split observability into two products with different trade-offs:

| Aspect               | Laravel Pulse                      | Laravel Nightwatch                            |
| -------------------- | ---------------------------------- | --------------------------------------------- |
| **Type**             | Self-hosted, open source           | Managed cloud SaaS                            |
| **Cost**             | Free                               | $0–$20+/mo (event-based pricing)              |
| **Data**             | Aggregated metrics only            | Event-level granularity                       |
| **Dashboard**        | Real-time widgets (Livewire cards) | Deep drill-down traces                        |
| **Error tracking**   | Exception frequency/recency        | Full stack traces + issue tracking            |
| **Query monitoring** | Slow query aggregates              | Individual query traces with timeline         |
| **Team features**    | None                               | Issue assignment, collaboration, priorities   |
| **Alerts**           | None                               | Configurable alerts, smart grouping           |
| **Server stats**     | CPU, memory, disk (via daemon)     | Server metrics via agent                      |
| **Request tracing**  | None                               | Full request timeline (microsecond precision) |
| **Queue monitoring** | Throughput cards                   | Job-level tracing + failure inspection        |
| **Cache**            | Hit/miss stats per key             | Not a focus                                   |
| **Custom cards**     | Livewire extensible                | N/A                                           |

**The problem**: To get the full picture, Laravel developers need _both_ — a free dashboard for glanceable metrics AND a paid service for deep tracing. Two different UIs, two different data stores, two different mental models.

### What Slipway Lookout Provides (The Marriage)

Lookout combines both into a single, self-hosted feature inside the Slipway dashboard:

#### Pulse-Side: The Glanceable Dashboard

Real-time cards showing vital signs at a glance:

| Card              | What It Shows                              | Sails-Native Twist                             |
| ----------------- | ------------------------------------------ | ---------------------------------------------- |
| **Servers**       | CPU, memory, disk per container            | Docker container stats via `docker stats` API  |
| **Slow Requests** | Endpoints exceeding threshold              | Sails action names, not generic Express routes |
| **Slow Queries**  | Waterline queries over threshold           | Shows model + method (e.g., `User.find()`)     |
| **Slow Jobs**     | Quest jobs exceeding threshold             | Sails Quest job names, not generic worker IDs  |
| **Exceptions**    | Frequency, recency, grouping               | Grouped by Sails action/helper origin          |
| **Queues**        | Pending, processing, failed, completed     | Sails Quest integration, per-queue breakdown   |
| **Cache**         | Hit/miss ratios per key group              | Redis service stats from Dock                  |
| **App Usage**     | Top users by requests, slow requests, jobs | Via Sails session/auth integration             |
| **Outgoing HTTP** | Slow external API calls                    | Machine helper calls tracked                   |

#### Nightwatch-Side: Deep Tracing & Issue Management

| Feature              | What It Does                                    | Sails-Native Twist                                            |
| -------------------- | ----------------------------------------------- | ------------------------------------------------------------- |
| **Request Timeline** | Microsecond-precision trace of every request    | Shows Sails lifecycle: policies → action → response           |
| **Query Inspector**  | Individual query analysis with explain plans    | Waterline model context (which `.find()` generated which SQL) |
| **Error Tracker**    | Stack traces → issues → assignment → resolution | Maps to Sails helpers/actions, not generic files              |
| **Job Inspector**    | Full job execution trace with retry             | Sails Quest job payload + execution context                   |
| **Alert Rules**      | Configurable thresholds with notifications      | "Alert when `POST /api/v1/deploy` > 30s"                      |
| **Issue Board**      | Kanban-style issue tracking for errors          | Built into Slipway's team/notification system                 |
| **Log Search**       | Searchable, filterable structured logs          | Container log aggregation via `docker logs`                   |

#### How It Works Technically

```
┌─────────────────────────┐       ┌──────────────────────────────┐
│   Your Sails App        │       │   Slipway Server (Lookout)   │
│                         │       │                              │
│  ┌───────────────────┐  │ OTLP  │  ┌────────────────────────┐ │
│  │ sails-hook-slipway│──┼──────▶│  │  Telemetry Collector   │ │
│  │                   │  │       │  └───────────┬────────────┘ │
│  │ Auto-instruments: │  │       │              │              │
│  │ • HTTP requests   │  │       │              ▼              │
│  │ • Waterline queries│ │       │  ┌────────────────────────┐ │
│  │ • Sails actions   │  │       │  │  SQLite / PostgreSQL   │ │
│  │ • Quest jobs      │  │       │  │  (event storage)       │ │
│  │ • Cache ops       │  │       │  └───────────┬────────────┘ │
│  │ • Outgoing HTTP   │  │       │              │              │
│  │ • Exceptions      │  │       │              ▼              │
│  └───────────────────┘  │       │  ┌────────────────────────┐ │
│                         │       │  │  Lookout Dashboard     │ │
│  Also collects:         │       │  │  • Pulse-style cards   │ │
│  • Container stats      │       │  │  • Deep trace viewer   │ │
│  • Log streams          │       │  │  • Issue tracker       │ │
└─────────────────────────┘       │  │  • Alert engine        │ │
                                  │  └────────────────────────┘ │
                                  └──────────────────────────────┘
```

**Data pipeline**:

1. `sails-hook-slipway` instruments the app via OpenTelemetry
2. Events stream to Slipway's telemetry collector (OTLP endpoint)
3. Slipway stores raw events (for tracing) AND computes aggregates (for dashboard cards)
4. Both views — cards and traces — powered by the same data, in one UI

**Key architectural advantage over Laravel's split**: Because Slipway stores event-level data AND computes aggregates from it, clicking on a "slow queries" card can drill down into the individual query trace. Pulse can't do this (aggregates only). Nightwatch can, but it's a separate product. Lookout connects them seamlessly.

### The Dashboard Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│  Lookout — myapp / production                              [1h ▾]  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─ Server ──────┐  ┌─ Requests ──────┐  ┌─ Errors ─────────────┐ │
│  │ CPU    23%     │  │ 1,247 req/min   │  │ 3 new exceptions     │ │
│  │ Memory 512MB   │  │ p95: 142ms      │  │ 12 total today       │ │
│  │ Disk   34%     │  │ p99: 890ms      │  │ ⚠ 1 unresolved       │ │
│  └────────────────┘  └─────────────────┘  └──────────────────────┘ │
│                                                                     │
│  ┌─ Slow Requests ─────────────────┐  ┌─ Slow Queries ──────────┐ │
│  │ POST /api/v1/deploy   4.2s (3x) │  │ User.find()     890ms   │ │
│  │ GET  /projects/:id    1.8s (12x) │  │ Project.find()  450ms   │ │
│  │ POST /api/v1/dock/sql 1.2s (8x)  │  │ Deployment.create 320ms│ │
│  │                   [View traces →] │  │             [Inspect →] │ │
│  └──────────────────────────────────┘  └─────────────────────────┘ │
│                                                                     │
│  ┌─ Queues ──────────────┐  ┌─ Cache ─────────────────────────────┐│
│  │ deploy   12 pending    │  │ Hit rate: 94.2%                     ││
│  │ email     0 pending    │  │ Most missed: user:session:*  (6%)   ││
│  │ backup    1 processing │  │ Most hit:   settings:global  (847)  ││
│  └────────────────────────┘  └─────────────────────────────────────┘│
│                                                                     │
│  ┌─ Exceptions ─────────────────────────────────────────────────┐  │
│  │ ● TypeError: Cannot read property 'id' of undefined          │  │
│  │   api/helpers/docker/run-container.js:47 — 3x in last hour   │  │
│  │   [Assign] [Resolve] [View trace →]                          │  │
│  │                                                               │  │
│  │ ○ ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:5432          │  │
│  │   api/helpers/dock/execute-sql.js:98 — 1x in last hour       │  │
│  │   [Assign] [Resolve] [View trace →]                          │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

Clicking "View trace →" on any item drills into the Nightwatch-style timeline:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Request Trace — POST /api/v1/deploy/trigger-deployment             │
│  Duration: 4,247ms | Status: 200 | User: admin@example.com         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Timeline                                                           │
│  ────────────────────────────────────────────────────               │
│  0ms      Policy: is-logged-in              2ms    ■                │
│  2ms      Policy: can-deploy                5ms    ■                │
│  7ms      Environment.findOne()             12ms   ██               │
│  19ms     Project.findOne().populate()      45ms   █████            │
│  64ms     docker build                      3800ms ████████████████ │
│  3864ms   docker run                        320ms  ██████           │
│  4184ms   Deployment.create()               15ms   ██               │
│  4199ms   Notification.send()               48ms   █████            │
│                                                                     │
│  Queries (4)                                                        │
│  ─────────                                                          │
│  SELECT * FROM environment WHERE id = ? AND ...       12ms          │
│  SELECT * FROM project WHERE id = ? ...               38ms          │
│  INSERT INTO deployment (project, ...) VALUES ...     15ms          │
│  INSERT INTO notification (user, ...) VALUES ...       3ms          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### What Apps/Services Lookout Replaces

When Lookout ships, Slipway users won't need any of these:

| Tool                     | What It Does                                   | Lookout Equivalent                  | Annual Cost Saved                 |
| ------------------------ | ---------------------------------------------- | ----------------------------------- | --------------------------------- |
| **Sentry**               | Error tracking, stack traces, issue management | Lookout error tracker + issue board | $26–$80/mo                        |
| **New Relic**            | APM, request tracing, server monitoring        | Lookout traces + server cards       | $25–$99/mo per host               |
| **Datadog**              | Infrastructure monitoring, APM, logs           | Lookout dashboard + traces + logs   | $15–$35/mo per host               |
| **BugSnag**              | Error monitoring, stability tracking           | Lookout error tracker               | $59–$249/mo                       |
| **Logtail/Better Stack** | Log aggregation, search, alerts                | Lookout log search + alerts         | $25–$85/mo                        |
| **Uptime Robot**         | Uptime monitoring, status page                 | Lookout health checks               | $7–$57/mo                         |
| **Laravel Pulse**        | Real-time dashboard cards                      | Lookout dashboard (same concept)    | Free (but Laravel-only)           |
| **Laravel Nightwatch**   | Deep tracing, issue tracking                   | Lookout traces + issues             | $20+/mo                           |
| **PM2 Plus**             | Node.js process monitoring                     | Lookout server cards                | $14–$79/mo                        |
| **Papertrail**           | Log management, search, alerts                 | Lookout log search                  | $7–$230/mo                        |
| **Prometheus + Grafana** | Metrics collection + dashboards                | Lookout dashboard cards             | Free (but complex setup)          |
| **Elastic APM**          | Full-stack observability                       | Lookout traces + dashboard          | Free (but massive infra overhead) |

**Conservative estimate**: A typical production Sails app using Sentry + a log service + uptime monitoring = **$50–$200/month**. Lookout provides all of this for $0 (self-hosted in Slipway).

### Why This Is Massive for the Sails Ecosystem

1. **No equivalent exists for Node.js/Sails**: Laravel has Nightwatch + Pulse. Rails has Skylight + Scout. Django has Silk. Sails has... nothing framework-aware. Lookout fills a void nobody else is addressing.

2. **Self-hosted by default**: Unlike Nightwatch ($20+/mo, cloud-only), Lookout runs on the same server as Slipway. Your data never leaves your infrastructure. This matters for GDPR, SOC 2, and HIPAA-conscious teams.

3. **Framework-native intelligence**: Generic APMs show you "Express middleware took 200ms." Lookout shows you "the `is-logged-in` policy took 2ms, then `User.findOne()` took 45ms in the `trigger-deployment` action." It speaks Sails, not Node.js generics.

4. **Zero-config for Slipway-deployed apps**: If your app is deployed via Slipway, Lookout works automatically. No agent installation, no SDK setup, no configuration. The telemetry hook is injected at deploy time.

5. **Connected to the deployment lifecycle**: Lookout can correlate errors with deployments. "This exception started appearing after deployment v1.2.3." No third-party tool can do this natively with Slipway.

6. **Unified experience**: One dashboard for deploying, managing databases (Dock), AND monitoring your app. No context-switching between 4 different tools.

### Implementation Phases

| Phase                        | What Ships                                                              | Timeline |
| ---------------------------- | ----------------------------------------------------------------------- | -------- |
| **Phase 1: Dashboard Cards** | Server stats, request/error counts, slow queries — the Pulse equivalent | MVP+1    |
| **Phase 2: Error Tracking**  | Exception capture, grouping, stack traces, issue board                  | MVP+2    |
| **Phase 3: Request Tracing** | Full timeline view, query inspector, dependency map                     | MVP+3    |
| **Phase 4: Alerts & Logs**   | Configurable alerts, log aggregation, search                            | MVP+4    |

### The Positioning

> **"Slipway Lookout: The observability platform that ships with your deployment platform. Zero setup. Zero cost. Full visibility."**

Or simpler:

> **"Every app you deploy with Slipway is automatically monitored by Lookout."**

This is the killer feature that makes Slipway not just a "deployment tool" but a complete **application operations platform** — and it's the feature that justifies charging for Slipway Cloud (managed hosting) while keeping self-hosted free.

---

## Summary

**Slipway** is an ambitious but achievable project that fills a genuine gap in the Sails.js ecosystem. By combining deployment, administration, monitoring, and Sails-native tooling into a single, beautiful platform, it can become the go-to solution for Sails developers worldwide.

The key to success:

1. **Start with MVP** - Core deployment first
2. **Iterate rapidly** - Ship early, get feedback
3. **Leverage AI** - Use AI assistants for productivity
4. **Build community** - Engage Sails developers from day one
5. **Stay focused** - Sails-native is the differentiator

**Let's build the platform Sails developers deserve.**

---

_This document is a living research artifact. Update as decisions are made and features are implemented._
