# Source publication and build isolation

Uploads are streamed through gzip and a tar parser into a unique directory.
Only regular files and directories are accepted. Absolute paths, traversal,
links, duplicate files, empty archives, and corrupt gzip/tar data are rejected.
The defaults cap expanded archive bytes at 1 GiB, entries at 20,000, and
extraction at 60 seconds. Available disk space can lower that budget; 256 MiB
is reserved and publication's second copy is included. Operators can lower
`custom.sourceArchiveLimits` (`maxBytes`, `maxEntries`, `timeoutMs`).

Publication preserves the old workspace until validation and copying finish.
A project lock excludes other publishers, content writers, and build snapshots.
The server returns `sourceRevision`; the CLI passes it to the deployment, which
builds a private copy of that exact revision. Legacy callers without a revision
build a snapshot of the workspace available when source preparation begins.
Repository builds clone into their own deployment directory and check out the
recorded commit, rather than changing another build's files.

Each project retains at most 20 uploaded revisions. A subsequent upload removes
unused revisions older than 24 hours; pending/running deployments protect their
revisions. Project cleanup includes retained revisions. The cap rejects new
uploads rather than silently evicting a revision a client may be about to use.

A process crash can leave `.source-locks/<project>` and publication staging or
previous directories. Locks deliberately fail closed. Stop source writers,
inspect `.source-previous-*` for a workspace interrupted during rename, restore
it if necessary, then remove the stale lock and unused staging directories.
Running containers are unaffected by source publication or its failure.
