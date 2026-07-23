# Service image versions

Slipway provisions backing services from tested numeric Docker tags and records
the immutable digest or image ID that Docker actually ran. It never stores
`latest` for a newly created service.

## Tested matrix

| Service    | Default | Other tested line | Automated upgrade |
| ---------- | ------- | ----------------- | ----------------- |
| PostgreSQL | 17      | 16                | 16 → 17           |
| MySQL      | 8.4     | 8.0               | 8.0 → 8.4         |
| Redis      | 7.2     | —                 | Not yet           |
| MongoDB    | 8.0     | 7.0               | 7.0 → 8.0         |

The defaults are deliberately stable release lines rather than aliases that
can cross a major-version boundary. Docker may publish newer patches within a
line, but every service stores the exact resolved digest. Restarting,
recreating, restoring, or updating Slipway therefore reuses the same image.

The current matrix is also available to authenticated clients:

```text
GET /api/v1/service-versions
```

## Creating services

Omit `version` to use the tested default:

```bash
slipway db:create main-db --type postgresql
```

Choose another tested line explicitly:

```bash
slipway db:create main-db --type postgresql --version 16
```

Custom versions must be numeric tags such as `17.4` or `8.0.12`. Slipway marks
them as outside the tested matrix. Mutable aliases, image variants, repository
names, and shell syntax are rejected; examples include `latest`,
`17-alpine`, and `postgres:17`.

## Existing services

At startup, Slipway finds legacy service records that still say `latest` or do
not have an immutable image reference. It inspects the existing Docker
container and image, records the detected version and digest, and leaves the
container and data volume untouched.

If the original container no longer exists, Slipway leaves the record visibly
unresolved instead of guessing. Restore the original container or recover the
actual version before attempting a recreation or upgrade.

## Upgrading a service

Supported upgrades are available from the service settings page. Slipway:

1. creates and verifies a logical backup in configured object storage;
2. resolves the target image before interrupting the running service;
3. starts the target version on a fresh named volume;
4. restores the verified backup and waits for the database to become ready;
5. promotes the restored container to the canonical service name; and
6. retains the stopped previous container and volume for recovery.

The page streams each step and records the backup and retained container in
the service upgrade state. An upgrade stops safely before cutover if the
backup, pull, startup, or restore fails.

Major-version upgrades are intentionally limited to tested adjacent lines.
Slipway does not automate downgrades, skipped releases, custom-version
upgrades, or Redis upgrades without a verified backup path.

## Recovery

After a successful upgrade, verify the application before deleting the
retained previous container or volume. The service settings page records the
exact previous container name and backup.

If verification fails:

1. stop the promoted service container;
2. rename the retained previous container back to the canonical service name;
3. start it; and
4. use the verified upgrade backup if a data restore is also required.

Retained containers and volumes are not deleted automatically. This keeps the
recovery boundary explicit until the operator confirms the upgrade.
