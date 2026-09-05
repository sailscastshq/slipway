# Dependency and release verification

The server/build toolchain requires Node.js 22.20+ on the 22.x line, or 24.12+;
the CLI and hook retain their separate Node.js 22+ requirement. This reflects
the supported ranges of the updated build and optional native dependencies.

CI installs the committed dependency tree with `npm ci --no-audit`. Releases call
the same lint, consistency, unit, functional, and browser workflow before building
and publishing an image. Both verification and image creation check out the exact
GitHub event commit. The installer uses caddy-docker-proxy 2.13.1 rather than the
moving latest tag.

Object storage uses AWS SDK v3 through a source-owned Skipper adapter. Uploads
remain streaming, multipart uploads use bounded concurrency, failed transfers
abort unfinished parts, and downloads retain stream cancellation. Presigned PUT
requests bind the content-type header. The old AWS v2 and skipper-s3 dependencies
are removed. The maintained @hapi/b64 implementation replaces the old b64 package
behind the existing upload-hook API; parser overrides remain within their major
versions. Editor, HTML sanitizer, mail, WebSocket and other compatible dependencies
are updated together in the lockfile.

Migration references:

- [AWS S3 migration guidance](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/migrate-s3.html)
- [Nodemailer 10 release](https://github.com/nodemailer/nodemailer/releases/tag/v10.0.0)
- [Maintained base64 streaming package](https://github.com/hapijs/b64)
- [Caddy Docker Proxy 2.13.1](https://github.com/lucaslorentz/caddy-docker-proxy/releases/tag/v2.13.1)

A dependency-range comparison against the saved audit is useful regression
coverage, but it is not a fresh advisory scan and does not prove that a tree has
no vulnerabilities. Run an approved fresh dependency audit before release.
