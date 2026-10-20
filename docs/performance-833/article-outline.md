# Article working outline: Nine apps, eleven app containers, and three memory stories

**Status:** factual draft for Sailscasts, not published. Native SIGBUS and production rollout remain open. Do not claim every performance problem is fixed.

## Opening scene

A healthy dashboard and gigabytes of free host memory did not mean each deployed app had enough memory. Two workloads were killed by their own memory cgroups while Slipway suffered a separate native bus error. Start with the confirmed 20 October 11:19:36 UTC v0.0.113 SIGBUS recurrence. Distinguish Sailsconf's 08:26/08:29 and FlossAfrica's 09:58/10:59 cgroup kills. A health/restart counter observed after restart cannot replace historical event correlation.

## What ten apps actually meant

Use `fleet-growth.png`. Retained records show three apps by 15 February, four by 26 February, five by 23 August and nine by 6 October. Ten projects existed by 19 October, with nine configured apps. Eleven app containers remained alive because two older generations persisted. With databases, caches, routing and platform/proxy there were 41 containers.

Explain the distinction between project, app, generation and process. An old numeric suffix mapped to another app's failed deployment, so names alone could not authorize cleanup.

## The container budget includes workers

Web, Quest/console and Bridge workers share a cgroup. Explain PSS/shared RSS and distinguish cgroup charge, file cache and JavaScript heap. The 512 MiB default was inadequate for confirmed workloads here. Show the per-app baseline and provisional 1 GiB recommendation, while budgeting worker/build concurrency and host headroom. Finite container ceilings already summed above physical RAM; this is overcommit potential, not proof all ceilings were consumed simultaneously. Raising ceilings does not repair a warning flood or native fault.

## The warning overhead we reproduced

FlossAfrica had 406 null refresh deadlines and 404 null eligibility values among 425 projects, while its model expected a number/boolean. Preserve the 21 existing verified values. Explain why `ADD COLUMN IF NOT EXISTS` does not install defaults/constraints when a nullable column already exists.

The manual transactional repair changes only nulls to existing model semantics and installs constraints. False grants no eligibility. Existing deadlines/observations remain intact. Zero deadlines can enter the existing opt-in, leased, bounded refresh queue, which is a deliberate semantic effect to review.

Use `floss-warning-before-after.png`: same local PostgreSQL/Waterline workload, seven alternating process pairs and ten reads each. Warnings fall from 8,100 / 11.46 MB to zero; median elapsed 490.6 to 109.2 ms; Node CPU 598.9 to 148.8 ms. These are matched synthetic ORM results, not production throughput or proof of OOM resolution.

## A small platform allocation fix

Use `log-count-before-after.png`. Keep collected text unchanged but count nonblank lines without retaining an array of every substring. A synthetic 89,146-line burst reproduces avoidable CPU/allocation overhead. Cover Unicode/blank/final-line regression checks, acknowledge small-log timing did not improve, and explicitly exclude Docker, redaction, persistence and HTTP from the claim.

## The missing historical curve

Retained container metrics begin 19 October, and request spans begin 13 October. No comparable CPU/RAM/traffic series survives from the initial three-app period. Do not invent a memory curve proving that ten apps exhausted the host. The growth graph documents retained record/deployment dates; benchmarks document controlled workloads. Very long request spans also need classification before being described as slow ordinary HTTP requests.

## An evidence-based ending

Two narrow fixes have reproducible local evidence. Native fault attribution remains unresolved. The migration and resource/lifecycle changes require separate approval. Closure needs at least 24 hours of representative traffic/scheduled peaks without new OOM/native failures or duplicate notifications, stable warmed memory/headroom and comparable ordinary-request latency.

Before publication, add actual approved production results, deployed revisions, workload comparability and remaining limitations. Keep internal host identities, raw logs, private records and credentials out of the article.
