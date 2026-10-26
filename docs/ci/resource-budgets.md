# Server CI resource budgets and download reuse

Issue [#873](https://github.com/sailscastshq/slipway/issues/873) introduces execution profile `sails-sqlite-no-egress-v4`. Release the matching server and CLI 0.0.5 before reviewing a new policy. The CLI executor digest and configuration digest change, so existing receipts cannot satisfy the new profile. An owner must explicitly review the new policy and approve devices again. This change does not migrate live policies or install production servers.

Required lint, test and build commands, fresh `npm ci`, dev dependencies and lifecycle scripts remain. Jobs still have two CPUs, 4 GiB memory with no extra swap, 256 processes, a twenty-minute deadline, a read-only root, non-root execution, dropped capabilities, no host mounts/credentials/socket, and disconnected network after installation. The existing transactional capacity fence admits one server job across apps. The pinned runtime is pulled only when missing; digest verification still applies.

The npm cache moves from the 256 MiB no-exec `/tmp` to the 1.5 GiB bounded executable workspace. This frees the temporary mount from package tarball storage, but it does not increase either quota or remove tmpfs memory accounting. npm audit/funding/update chatter is disabled during install, and native build jobs are capped at two. Separate vulnerability review remains necessary; npm integrity verification is retained.

## Bounded reuse

The server keeps one global private download archive under `.tmp/ci-package-cache`: at most 64 MiB retained plus one 64 MiB replacement while writing. Entries expire after seven days and are evicted on the next admitted run. Switching apps/keys evicts the previous slot, intentionally trading hit rate for a small fixed disk budget. Archives contain only npm `_cacache` regular files/directories; no source, node_modules, credentials or build artifacts are retained. Archive validation rejects links, devices, path traversal, non-cache paths, paths over 512 characters and more than 10,000 entries. No archive is extracted on the management host.

Keys bind app, repository, reviewed branch/policy revision, exact lock bytes, immutable runtime/platform/Node/npm versions and execution configuration. Different apps, branches, policies, locks or runtimes do not share entries. Restore is a cache hint, never evidence that checks passed. npm still verifies package contents against the lockfile. Reuse is disabled for a graph containing Git/file/link/workspace packages or any non-root package without HTTPS resolution and SHA-512 integrity. Cold install still runs for those graphs.

Corrupt archives become misses; npm refetches tampered package content. Oversized exports are discarded; unchanged warm archives are not rewritten. Package download storage is bounded in the job by the workspace quota, and in the controller by the archive byte/entry limits. Large graphs exceeding the archive budget remain cold. A multi-app instance may also see misses from the single-slot eviction policy.

## Evidence and limits

The executor records cumulative cgroup CPU and run peak memory, CPU consumed between step samples, and each mount's total/available bytes and inodes. Memory peaks are cumulative, not independent per-step peaks; interval CPU includes intervening cache/network setup and sampling overhead. The server retains these numeric fields and cache outcomes after private raw evidence is removed. Failure messages direct operators to mount capacities and private logs; free host disk alone does not exclude tmpfs ENOSPC.

The [sanitized measurement](evidence/resource-cache.json) uses the same fixture commit, pinned AMD64 Node v22.23.4/npm runtime, commands and isolation for baseline, new cold and new warm. It installs Acorn 8.18.0, verifies native sandbox properties and reruns install lifecycle code in every fresh workspace. Local Docker Desktop runs AMD64 via emulation on an ARM Mac. Each row is one sequential observation, not a statistical performance claim. Image layers were already available; baseline still performs its pull check. Host network/cache state and machine load can vary.

| Path              | Install |  Total | Cgroup CPU | Peak memory | Retained download archive |
| ----------------- | ------: | -----: | ---------: | ----------: | ------------------------: |
| Baseline 8565a4d8 |   2.22s | 10.51s |      5.58s |  112.25 MiB |                      none |
| v4 cold           |   2.48s | 11.28s |      6.09s |  111.95 MiB |                   140 KiB |
| v4 warm           |   1.28s | 10.14s |      5.94s |  108.25 MiB |            reused 140 KiB |

Warm install was 42% shorter than baseline, while total time was only 3.5% shorter; CPU increased about 6%. Cold total time increased about 7%. This tiny graph emphasizes controller overhead and proves cache behavior, not real application speed. No production workload/CPU/disk improvement is established. Post-run byte counts measure occupied capacity at sample time, not I/O volume or peak disk use. Baseline did not record mount bytes/inodes, so no baseline disk delta is claimed.

Reproduce the optional baseline comparison by exporting `bin/ci-server-executor.cjs` and `api/lib/contracts/ci-contract.js` from 8565a4d8 to `/tmp/ci-baseline-executor.cjs` and `/tmp/ci-baseline-contract.js`, then run:

```sh
CI_SERVER_DOCKER=1 CI_SERVER_BASELINE=/tmp/ci-baseline \
  CI_SERVER_EVIDENCE=/tmp/ci-measurements \
  node --test tests/prelift/ci-server-executor.test.cjs
node --test tests/prelift/ci-package-cache.test.cjs
```

The real Docker fixture also checks archive corruption, tampered cached content, scope mismatch, byte cap, expiry, ineligible lockfiles, fresh installation lifecycle, preserved lint/test/build, sandbox properties and exact owned-container removal. The archive boundary unit check runs in the existing dependency-equipped unit CI job.

## Deferred storage and build work

A plain Docker volume has no portable size quota. The measured local daemon uses overlay2 on extfs, and replacing tmpfs with such a volume would drop the storage protection. Keep tmpfs until a dedicated runner can enforce per-job filesystem quotas without privileged jobs, host mounts or broader trust. Disk-backed workspaces are still unresolved; the 256 MiB temporary preparation quota can still be exhausted by large Git dependency builds.

The source-check build is discarded and deployment builds its candidate separately. Those outputs have different artifact/runtime verification contracts. This change does not promote arbitrary source-check output as a tested image, skip checks, select tests by changed files, or bypass final runtime parity. Reusing a tested immutable artifact needs separate end-to-end provenance work.

References: [npm cache integrity and semantics](https://docs.npmjs.com/cli/v11/commands/npm-cache/) and [Docker tmpfs accounting and constraints](https://docs.docker.com/engine/storage/tmpfs/).
