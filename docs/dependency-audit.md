# Dependency audit follow-up (#647)

The 2026-10-03 registry audit of `2cc1184` reported ten entries: eight high,
one moderate and one low, with zero critical. The candidate lockfile patches
Nodemailer 10.0.0 → 10.0.14, DOMPurify 3.4.15 → 3.4.16,
brace-expansion 1.1.18 → 1.1.21 and 2.1.4 → 2.1.7, and
ip-address 10.7.0 → 10.7.3. No direct dependency changes major version.

## Paths and exposure

| Entry                                                   | Dependency path                                                        | Exposure                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Nodemailer                                              | Slipway → nodemailer                                                   | Production configured SMTP transport; mail helper tests exercise delivery through Sounding's disposable mailbox.                                                                                                                                                                                 |
| DOMPurify                                               | Slipway → dompurify                                                    | Browser Bridge Markdown sanitation. Slipway passes a string to `sanitize`, without `IN_PLACE` or an `afterSanitize` hook. Existing adversarial Markdown browser regressions remain required.                                                                                                     |
| brace-expansion 1                                       | Sails/EJS → glob/minimatch → brace-expansion                           | Server template/module file discovery and development tooling; patterns come from application source/configuration.                                                                                                                                                                              |
| brace-expansion 2                                       | EJS → jake → filelist/minimatch → brace-expansion                      | Build/template file discovery.                                                                                                                                                                                                                                                                   |
| ip-address                                              | express-rate-limit → ip-address                                        | Production IPv6 address/key normalization; patched despite no Slipway use of `isInSubnet`.                                                                                                                                                                                                       |
| meow / trim-newlines                                    | sails-hook-dev → pretty-bytes 1.0.4 → meow 3.7.0 → trim-newlines 1.0.0 | Development memory formatting hook, also installed in the current production image; its routes reject production access by default. The formatter imports the numeric pretty-bytes function; meow and trim-newlines belong to pretty-bytes' separate CLI, never imported by its function module. |
| braces / micromatch / fast-glob / sails-hook-shipwright | sails-hook-shipwright → fast-glob → micromatch → braces 3.0.3          | Development/production asset **build** discovery using repository-owned glob patterns, not request-supplied patterns. The Dockerfile installs development dependencies too, and Shipwright may run during production startup. This is build-pattern exposure, not a request-input path.          |

The remaining fresh audit contains six high entries, representing two underlying
advisories, zero moderate/low/critical entries:

- [trim-newlines resource consumption (GHSA-7p7h-4mm5-852v)](https://github.com/advisories/GHSA-7p7h-4mm5-852v).
  No patched 1.x exists. Retain the old development-only CLI dependency until
  sails-hook-dev replaces its pinned pretty-bytes dependency. Do not force a
  major override of the hook's pinned dependency in this patch.
- [braces stack exhaustion (GHSA-vfj7-8cjw-p6xm)](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
  The registry's latest braces is still 3.0.3; 3.0.4 returns 404. npm proposes a
  major downgrade of Shipwright to 0.4.0, which would remove current asset/HMR
  behavior. Retain it for source-controlled build patterns and follow up when
  upstream publishes a compatible patch. Do not accept untrusted glob patterns
  in build configuration.

These are unresolved development/build entries for this patch. Risk acceptance
has not been authorized. Keep #647 open pending a compatible remediation or an
explicit maintainer decision; this is not a clean audit or a sandbox. Recheck registry metadata before release;
new advisories or upstream fixes change this assessment.

## Verification and release gate

Reproduce with the committed lockfile and supported Node version:

```sh
npm ci --no-audit
npm audit --json
npm run test:unit
npm run test:functional
npm run test:e2e
npm run local
npm run local:upgrade-check -- 0.0.86
```

The CI dependency upgrade job runs the documented disposable local boot and
previous-release SQLite upgrade check on Linux. The full existing workflow owns
mail, editor sanitation, streaming and storage regressions. Record exact-head
CI results in the PR before merging; local Docker is unavailable on the authoring
host and does not count as executed proof. Do not close #647 until these gates pass.
