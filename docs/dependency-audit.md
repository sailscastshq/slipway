# Dependency audit follow-up (#647)

The prior 2026-10-03 registry audit of `2cc1184` reported ten entries: eight high,
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

The prior patch audit contained six high entries, representing two underlying
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

## Fresh audit on 2026-10-06

Remote main base: `a21374de4dd06657f5b0cd1092813f2be9a14710`.
Node 24.14.1 / npm 11.11.0, audit report version 2. Before: 16 entries
(two critical, twelve high, two moderate); after the targeted patch: eleven
(two critical, six high, three moderate). Counts include vulnerable parents;
the remaining entries represent four underlying advisories. This is not a clean
security audit or risk acceptance.

The only dependency changes are compression 1.8.1 → 1.8.2, proxy-addr
2.0.7 → 2.0.8 and source-map-js 1.2.1 → 1.2.2. Sails pins compression,
so a parent-scoped same-major patch override is required. Express and the
source-map consumers already permit their patches. All patched packages retain
Node engine floors below Slipway's unchanged `^22.20.0 || >=24.12.0`.
No CLI, hook, storage SDK, SQLite, mail, editor or streaming API was replaced.

| Underlying advisory                                                                          | Exact path and exposure                                                                                                                                                                                                                                                                                                    | Result / follow-up                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [compression premature-close memory leak](https://github.com/advisories/GHSA-vc2v-76pw-4v95) | Sails 1.5.18 → compression 1.8.1; Sails enables compression middleware in production. SSE explicitly uses `Content-Encoding: identity`.                                                                                                                                                                                    | Patched to 1.8.2 through the scoped Sails override; verify aborted responses and SSE contracts.                                                                                                                                                                                                                                                                                                                 |
| [proxy-addr mapped-IPv6 subnet spoofing](https://github.com/advisories/GHSA-jqcg-44mw-7w3h)  | Express 4.22.2 / 5.2.1 → proxy-addr 2.0.7, plus sails-hook-sockets 3.0.2 → pinned proxy-addr 1.1.5. Sockets builds a request from handshake address/headers and calls `proxyaddr` / `proxyaddr.all` with Express's trust function. Production `trustProxy: true` alone does not prove this advisory's subnet precondition. | Express copies patched to 2.0.8. The sockets copy remains critical in the scan. [Upstream PR 54](https://github.com/balderdashy/sails-hook-sockets/pull/54) proposes a tested major dependency transition, but no published hook fix was available. Wait for a published compatible hook release, or obtain explicit approval for a separately reviewed transition; do not silently force the transitive major. |
| [source-map-js indexed-map offsets](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)       | Vue compiler-core/compiler-sfc, PostCSS and @tailwindcss/node → source-map-js 1.2.1; repository asset compilation/source-map processing. Development dependencies ship in the image.                                                                                                                                       | Patched to 1.2.2 in the existing ranges.                                                                                                                                                                                                                                                                                                                                                                        |
| [sprintf-js unbounded precision](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)          | Sails 1.5.18 → i18n-2 0.7.3 → sprintf-js 1.1.3. i18n-2 calls `vsprintf` on translated message formats. Slipway's locale/message sources are repository owned; audit alone does not establish attacker-controlled precision.                                                                                                | Registry latest remains 1.1.3, with no published patch. Follow upstream remediation or propose a separately tested formatter replacement; no waiver applied.                                                                                                                                                                                                                                                    |
| [trim-newlines resource consumption](https://github.com/advisories/GHSA-7p7h-4mm5-852v)      | sails-hook-dev 1.3.0 → pretty-bytes 1.0.4 → meow 3.7.0 → trim-newlines 1.0.0. The hook imports numeric `pretty-bytes.js`; only its separate `cli.js` imports meow. Production dev routes are gated.                                                                                                                        | Registry still has no 1.x patch; retain pending hook replacement of its pinned formatter. No forced major override.                                                                                                                                                                                                                                                                                             |
| [braces stack exhaustion](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)                 | sails-hook-shipwright 1.5.1 → fast-glob 3.3.3 → micromatch 4.0.8 → braces 3.0.3; source-controlled asset discovery, potentially production startup/build.                                                                                                                                                                  | Registry latest remains 3.0.3. npm's proposed Shipwright 0.4.0 downgrade is incompatible with the current build contract. Await a compatible upstream patch.                                                                                                                                                                                                                                                    |

The newly found sockets and sprintf advisories require their own explicit
maintainer decision if they cannot be remediated before release. An exception
for another project does not authorize Slipway acceptance. Existing historical
advisories also remain unresolved here; this task does not establish a prior
Slipway risk exception. Keep #647 open. No unrestricted audit fix, global audit
waiver, forced major override, tag, npm release or production operation is used.

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
