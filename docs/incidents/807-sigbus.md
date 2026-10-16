# SIGBUS incident and proposed connection-policy mitigation

On October 16, 2026, Slipway 0.0.100 repeatedly exited with `Bus error (core dumped)` and Docker exit code 135. One verified run lasted 608 seconds. The route container's later termination belongs to startup route replacement. Separate memory-cgroup OOM kills were mapped to Chieflevite and FLOSSAfrica, not Slipway. Earlier `database is locked` / `E_BUSY` errors are confirmed but do not establish the SIGBUS cause.

## Review change

Disable database-file mmap on all four ORM SQLite connections using the adapter's supported `pragmas: { mmap_size: 0 }` configuration. The installed `sails-sqlite` defaults to 256 MiB mmap. No native dependency, schema, journal mode, synchronous policy, data, or schedule changes are included.

This removes one plausible native crash path; it is a mitigation hypothesis, not a proven production fix. SQLite documents that I/O errors in mapped files can terminate the process instead of becoming ordinary SQLite errors. Reads may use more copying and be slower on some workloads; the effect is unmeasured here. WAL and ordinary reads/writes remain supported. Existing connections require a separately approved rollout/restart to adopt the policy. There is no existing Slipway-specific environment switch for this setting; the per-datastore adapter pragma is supported already.

Tests register each real datastore configuration against disposable files, verify effective mmap=0, retain WAL and NORMAL synchronization, exercise two connections, and checkpoint only disposable fixtures. The generic truncated-mapping demonstration is not a reproduction of the application's crash.

Sources: [SQLite mmap behavior](https://sqlite.org/mmap.html), [incident #807](https://github.com/sailscastshq/slipway/issues/807).

## Separate proposal: console worker isolation

Quest launches `sails run` workers in the console environment. The console config disables several web hooks but currently leaves Lookout enabled. Every worker therefore initializes additional metrics/reconciliation/alert timers. Quest's log line saying it started seven jobs is unconditional even when child scheduling is disabled; it is not proof of recursive scheduling or a container restart.

A separate small change could add `lookout: false` to the hooks object in `config/env/console.js`. This would leave the resident web collector active and preserve explicitly invoked scheduled maintenance helpers while removing duplicate worker-side collectors. Validate console job dependencies and test that worker loading creates no Lookout timers while the resident process still collects. This proposal is not applied in this mitigation branch and is not proven to resolve SIGBUS. Adapter connection initialization also performs ANALYZE, so disabling Lookout alone would not eliminate every worker write.

## Apport evidence, metadata only

The host uses Apport, not systemd-coredump. Do not install a replacement crash handler or upload a complete `.crash` report: these can include CoreDump, ProcEnviron and other secrets. The user inspected `/var/crash` and it was empty. No retained native report is available, so the faulting module remains unconfirmed. An installation suggestion in pasted shell output is not evidence that another handler was installed.

For a selected `.crash` file, print only scalar metadata fields (no continuation lines):

```sh
sudo awk '/^(ProblemType|Date|Signal|SignalName|ExecutablePath|ExecutableTimestamp|Architecture|Package|DistroRelease|Uname):/ { print }' /var/crash/SELECTED.crash
```

Use the actual listed filename instead of the placeholder. Do not run apport-unpack/retrace automatically: those can extract a large core or fetch packages. A separately reviewed native stack, fault address and mapped module/file would distinguish a SQLite mmap fault from other native faults. ProcMaps can contain private paths; do not dump it or ProcEnviron into public issue output. Review current mount free space and DB/WAL/SHM metadata without modifying/checkpointing live files.

No production configuration, restart, cleanup, migration, rollback, or release was performed for this branch.
