# Slipway 0.0.54

Slipway 0.0.54 makes Bridge a resident application runtime instead of paying
the cost of booting the target Sails application for every page operation. It
also keeps app-local Bridge browsing on the host application's `/bridge` URL.

## Bridge performance

### What was happening

Every Bridge operation started `docker exec ... node`, loaded the deployed
Sails application, ran one operation, lowered Sails, and exited. A Bridge page
can perform introspection, authorization, dashboard, count, and record queries.
Search repeated the same pipeline after its 300 ms debounce. Overlapping
searches therefore created multiple temporary Sails processes, so later
navigation appeared to stop responding while earlier work completed.

### What changed

- One production-mode Bridge worker is reused for each live app container.
- Bridge-enabled apps are prewarmed after deploy and rollback and when Slipway
  starts, keeping Sails bootstrap work outside normal Bridge requests.
- A timeout or stopped container discards the worker so the next operation can
  recover with a new one.
- Record searches use an Inertia partial reload and do not repeat unchanged
  dashboard work.
- A new `local.sh bridge-benchmark` command compares the old lifecycle with
  the resident runtime and fails when any warm operation reaches 500 ms.

The resident worker intentionally remains separate from the application's web
process. This preserves the existing execution boundary, so an expensive or
failed Bridge operation cannot block the public application's event loop.

### Local measurements

On August 3, 2026, the reproducible local Docker benchmark recorded:

| Measurement                         | Result                |
| ----------------------------------- | --------------------- |
| Old per-operation lifecycle         | 5,566 ms and 4,803 ms |
| One-time deployment/startup prewarm | 4,864 ms              |
| Five consecutive warm operations    | 1, 0, 0, 0, and 0 ms  |
| Slowest warm runtime operation      | 1 ms                  |

These numbers isolate Bridge runtime overhead. Database execution, network
latency, the 300 ms search debounce, and browser rendering remain part of the
complete user-visible latency.

### Verification

Start the local Docker stack and run the latency assertion:

```bash
bash ./local.sh
bash ./local.sh bridge-benchmark
```

Then run the regression lanes:

```bash
npm run test:unit
npm run test:functional
```

The 0.0.54 release gate is:

- no target Sails bootstrap during warm navigation or search;
- every warm runtime operation below 500 ms;
- a table-only search does not re-run dashboard queries;
- worker timeout is bounded and the next operation starts a clean worker;
- first visible Bridge page below two seconds in the production smoke test;
- subsequent navigation below 500 ms in the production smoke test; and
- search results begin rendering within 800 ms after the final keystroke.
