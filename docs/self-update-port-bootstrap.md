# Legacy self-update host-port conflict

An updater running in Slipway 0.0.87, 0.0.88 or 0.0.89 can choose a validation port from stale application records. An app that already owns that port then prevents `slipway-next` from starting. Updating the advertised target image does not replace the running updater.

Validation already probes `/health` with `docker exec` inside the candidate; it does not need a published host port. Current updater code therefore allocates no validation port and keeps the existing dashboard binding for the final production swap.

## Bootstrap the running legacy updater

Check the installed version without printing credentials:

```bash
docker exec slipway node -p 'require("./package.json").version'
```

Download `scripts/bootstrap-unpublished-update.cjs` from a reviewed commit in this repository, then run it inside the existing management container:

```bash
docker exec -i slipway node < /tmp/slipway-update-bootstrap.cjs
```

Proceed only if this prints `patched` or `already patched`. The script supports 0.0.87, 0.0.88 and 0.0.89, requires the exact known publication statement and container-local health probes, validates JavaScript syntax before writing, saves a private source backup, and atomically replaces the updater helper. For 0.0.87 it also increases both candidate and final-container health waits from one to six minutes, so a verified database migration has time to complete. Both helper sources are validated before either file changes; write failures restore already-applied files. It does not open database files or change encryption keys, environment variables, application containers, or Docker bindings. A source mismatch stops without changing the helper.

Restart only the management container so Sails reloads the helper, then retry the regular update in Settings:

```bash
docker restart slipway
```

The management interface briefly disconnects during this restart. Customer apps and their routing containers remain running. The bootstrap is temporary container source repair; it is not a database recovery step and does not add the permanent fix to an already published release image.

## Verification

- The exact one-line patch, syntax validation, and idempotence were checked against the published `v0.0.89` source. The 0.0.87 repair is tested inside its actual published Docker image, including both health deadlines, syntax, private backups, and idempotence.
- Unit trials exercise successful validation without allocation/publication, failed-start cleanup, preserved production bindings, safe Docker error formatting, and Bosun rollback.
- The Docker contract reproduces the container/host namespace mismatch, successfully publishes the allocator's alternative port, and runs the production health probe against a candidate with no published ports while the occupied app remains running. Its fixtures are labeled and ownership-checked before cleanup.

Do not remove or stop the application that owns the conflicting port. Once the host-aware allocator release is installed, retry failed app deployments separately. Their success still needs verification on the affected installation.
