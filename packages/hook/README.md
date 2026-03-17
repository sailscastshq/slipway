# sails-hook-slipway

> The Sails hook that makes your app Slipway-aware

## What It Does

This hook transforms any Sails app into a fully-managed application with:

- **The Bridge** - Auto-generated CRUD for all your models (ship's command center)
- **The Helm** - Production REPL with full Sails context (where you steer your app)
- **Quest Dashboard** - Job queue management (if sails-quest installed)
- **Content CMS** - Visual content editor (if sails-content installed)
- **Telemetry** - OpenTelemetry instrumentation sent to Slipway

## Routes

| Route              | Feature                      | Condition                 |
| ------------------ | ---------------------------- | ------------------------- |
| `/slipway`         | Control panel dashboard      | Always                    |
| `/slipway/bridge`  | The Bridge (data management) | Always                    |
| `/slipway/helm`    | The Helm (REPL)              | Always                    |
| `/slipway/quest`   | Job queue dashboard          | If sails-quest detected   |
| `/slipway/content` | CMS interface                | If sails-content detected |

## Two Access Methods

### 1. Direct (via app URL)

```
myapp.example.com/slipway/bridge
myapp.example.com/slipway/helm
```

Users go directly to your app's Bridge or Helm.

### 2. Via Slipway Dashboard (centralized)

```
slipway.yourdomain.com/app/myapp/bridge
slipway.yourdomain.com/app/myapp/helm
```

The Slipway Dashboard proxies requests, providing single sign-on across all apps.

## Installation

```bash
npm install sails-hook-slipway
```

The hook auto-registers with Sails.

## Configuration

```javascript
// config/slipway.js
module.exports.slipway = {
  bridge: {
    enabled: true,
    path: '/slipway/bridge'
  },
  helm: {
    enabled: true,
    path: '/slipway/helm',
    readOnly: false // Set true in production
  },
  quest: {
    enabled: true // Auto-disabled if sails-quest not installed
  },
  content: {
    enabled: true // Auto-disabled if sails-content not installed
  },
  telemetry: {
    enabled: true,
    endpoint: process.env.SLIPWAY_TELEMETRY_URL
  }
}
```

## Permissions (Sails Clearance)

The hook integrates with Sails Clearance for fine-grained access control:

```javascript
{
  'bridge:read': ['admin', 'support'],
  'bridge:write': ['admin'],
  'helm:access': ['admin', 'developer'],
  'quest:retry': ['admin', 'developer'],
  'content:publish': ['admin', 'editor']
}
```

## Dev Mode

When you run `slipway dev`, this hook provides the full experience locally:

```bash
slipway dev

  App:      http://localhost:1337
  Bridge:   http://localhost:1337/slipway/bridge
  Helm:     http://localhost:1337/slipway/helm
```

## Part of the Slipway Suite

- **Slipway Dashboard** - Can proxy to this hook's routes
- **slipway CLI** - `slipway helm` connects to this hook

---

_Where your apps slide into production._
