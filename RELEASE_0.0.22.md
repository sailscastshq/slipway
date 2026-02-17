## Bug Fixes

### Fix Docker build failing inside Slipway container (#66)

App deployments failed with `unknown flag: --progress` because the Docker CLI inside the Slipway container used the legacy builder instead of BuildKit.

The container mounts the host's Docker socket (daemon v29 with BuildKit), but the CLI binary (`docker-ce-cli`) didn't include the BuildKit plugin — so it fell back to the legacy builder which doesn't support `--progress=plain`.

**Fixes:**

- Set `DOCKER_BUILDKIT=1` environment variable when spawning builds, forcing the CLI to use BuildKit from the host daemon
- Added `docker-buildx-plugin` to the Dockerfile so future container images have native BuildKit support

## Upgrade

Re-run the install script to pick up the update:

```bash
curl -fsSL https://raw.githubusercontent.com/sailscastshq/slipway/main/install.sh | bash
```

---

**Full Changelog**: https://github.com/sailscastshq/slipway/compare/v0.0.21...v0.0.22
