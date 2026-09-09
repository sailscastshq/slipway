# Deployment readiness

Open an app or its environment to see **Deployment readiness**, or run:

```sh
slipway push
slipway readiness --env production
slipway readiness --env production --app web --json
```

The CLI and dashboard request the same server-owned report for the available source, selected app, and effective global/environment/app configuration. `slipway init` shows the initial report; push source to inspect it before the first deployment. A connected repository is inspected again after synchronization into the deployment snapshot.

Use an [actively supported Node LTS release](https://nodejs.org/en/about/previous-releases), such as 22 or 24.

Required checks block deployment only when inspection proves a problem: a missing configured Dockerfile, an explicitly unsupported Node runtime (below 22, or the EOL 23/25 lines), or an explicitly required environment variable that is absent. Startup scripts, session durability, unverified configuration, and optional capabilities are advisory. Recommendations do not disable the deployment control.

To declare variables that must exist, add this data to the app's package.json:

```json
{
  "slipway": {
    "readiness": {
      "requiredEnv": ["DATABASE_URL", "PAYMENT_KEY"]
    }
  }
}
```

Names must be uppercase environment-variable identifiers. The report returns missing names, never values. PORT is provided by Slipway. Application configuration is parsed as data; inspection never executes a config module. Dynamic configuration that cannot be proven remains advisory.

Managed database and Redis services are optional. A configured external URL is accepted as connection configuration, with reachability still verified by the app during startup. Redis guidance follows an explicitly detected production session/socket adapter. Other applications receive conditional guidance about durable sessions; installed Redis packages alone do not impose a Redis requirement.

`sails-hook-slipway` unlocks configured Bridge and Lookout capabilities and is optional for deployment. Quest, Content, and uploads appear only when their supporting packages are declared. Package detection describes declarations, not proof that a capability has been configured or successfully exercised.

The report records a keyed source fingerprint and configuration version. Refresh after source or settings change. The API accepts `previousVersion` and reports whether it is stale. Inspection is bounded and does not follow source symlinks; incomplete source inspection is explicitly unverified. Generated dependencies and caches are excluded.

The health path uses the same normalization as App settings. Slipway sets PORT=1337; the app must listen on container port 1337. The deployment pipeline checks readiness before building and again against its resolved runtime configuration, then probes the candidate's configured HTTP path before switching traffic. A prior probe is marked stale when source or configuration changes. A failed historical probe is advisory so a transient failure can be retried; an actual failing candidate probe prevents cutover.
