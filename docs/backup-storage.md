# Private backup storage

Settings → File storage → Backup storage controls database backups separately from public uploads. The default uses existing file-storage credentials; no new configuration is needed for an existing private S3-compatible bucket. Choose a separate provider when public uploads and backups need different storage.

| Provider                                             | Private backup upload/download/delete | Public uploads                 |
| ---------------------------------------------------- | ------------------------------------- | ------------------------------ |
| R2, S3, Spaces, MinIO, custom S3-compatible endpoint | Supported through the S3 adapter      | Existing file-storage settings |
| Azure Blob Storage                                   | Supported through the Azure SDK       | Not offered                    |

A connection test uploads a small temporary object, downloads and verifies it, checks anonymous reads, and deletes it. Save runs the same test before committing configuration. No public URL is required for backups. Anonymous checks cover the object endpoint and a configured public delivery URL; separate CDN aliases, future policy changes, and provider version-retention policies remain the operator's responsibility. Use a private bucket/container and deny anonymous access at the provider.

S3 credentials need object read/write/delete permissions and permission to abort multipart uploads for failed-transfer cleanup. Use the provider’s equivalent least-privilege policy.

Backup orchestration lives in `api/helpers/backup`. Transfers use `sails.uploadOne()`, `sails.startDownload()`, and `sails.rm()` from `sails-hook-uploads`, with the selected backup credentials passed explicitly. Provider adapters live in `adapters/`; S3/R2 backups share the S3 adapter used by team logos and Bearing images. Backup helpers retain byte limits, deadlines, checksums, collision protection, and failed-upload cleanup.

## R2 and AWS S3 setup

For R2, create a dedicated bucket such as `slipway-backups`. Keep both its public development URL and custom domains disabled. A folder named `backups/` inside a public R2 bucket does not make those objects private. Create an **Object Read & Write** token scoped to the backup bucket, and use the generated **Access Key ID** and **Secret Access Key** (not the Cloudflare bearer API token).

In Settings → File storage → Backup storage, choose **S3-compatible storage**. Enter the private bucket, credentials, region `auto`, and the account's **S3 API endpoint** from R2. The endpoint must not be the public bucket/custom-domain URL and must not include the bucket name. Test the connection and save. Existing public uploads keep their current settings. No Slipway redeploy is required for this configuration change.

For AWS S3, use a private bucket with Block Public Access enabled, its actual region, and credentials scoped to its objects with `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, and `s3:AbortMultipartUpload`. Leave the endpoint field blank for standard AWS S3. A customer-managed KMS key also requires the appropriate KMS permissions.

The chosen backup storage covers managed/external database backups, scheduled backups, and Slipway's pre-update database snapshot. Verify a manual backup and download before relying on the next scheduled run. Existing backups retain their original storage credentials and location.

If privacy verification fails, the error reports whether the unsigned **storage API** or **public delivery** check failed, its HTTP status, and a bounded provider XML error code where available. URLs, credentials, and provider message bodies are not included. Redirects, throttling, malformed requests, and outages are not evidence of private access. Check the API endpoint and the reported provider response before retrying.

To inspect R2's unsigned response from the Slipway server without credentials, replace the account and bucket below and run:

```bash
curl --max-time 15 -i -H 'Range: bytes=0-0' \
  'https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com/slipway-backups/slipway-response-check'
```

This nonexistent diagnostic key helps identify endpoint/authentication responses; it does not establish the privacy of an existing object. After deploying the updated diagnostics, run **Test connection** and inspect the page message or the `[backup-storage] Connection verification failed` server log for the actual uploaded test object's check. Do not share credentials or signed URLs.

Cloudflare's bucket settings offer **Data Access Logs → Enabled**, followed by **View logs in Workers Observability**. New supported successful requests can show upload and deletion activity. These logs exclude HTTP responses of 400 or greater, so the client response and Slipway diagnostic are needed for the failed check. See [R2 Data Access Logs](https://developers.cloudflare.com/r2/buckets/data-access-logs/).

## Azure

Enter the account and existing private container. Prefer a container-scoped SAS token with **read, write, delete** permissions and a future expiry. Account keys are also supported. Both are encrypted at rest and omitted from browser props and logs. Blank credential fields retain the saved value. Custom endpoints are optional; HTTP requires an explicit trusted-private-network opt-in.

Azure is supported for backup storage, including manual/scheduled backups, restore downloads, retention deletion, pre-update Slipway snapshots, and cleanup. It does not make an Azure database a managed Docker service; external database support is separate.

## Compatibility and recovery

Existing `s3Key` records continue to work. Before changing shared storage settings, Slipway binds legacy backup records to their original encrypted configuration. New records store a neutral object key, provider/container, byte size, SHA-256 checksum, ETag and provider version metadata. A restore uses that backup's connection, even after a provider switch. Saving verified replacement credentials for the same provider and storage location also updates matching backup records. This lets you renew a SAS token or rotate a key without losing older backups. Backups at a different location keep their existing credentials; keep that location accessible until they are no longer needed.

New uploads use unique keys and conditional writes, and reject an observed anonymous read. Existing downloads are not blocked by this new upload privacy check. A currently public backup location must be replaced with a private backup location before creating more backups.

Transfers have size/time bounds. Cancellation and failed uploads attempt cleanup; a failed cleanup retains the object reference for the scheduler to retry. Retention keeps the database record when object deletion fails. Project/service cleanup seals the original storage connection before deleting records, so retries do not accidentally use a different provider. Keep the instance encryption keys with your recovery material.

Deletion addresses the current object. Provider-managed historical versions, snapshots and soft-delete retention may remain according to the bucket/account policy. Configure lifecycle expiry for historical versions; do not assume Slipway's retained-backup count is the provider's physical byte-retention limit.

## Verification

The CI contract uses the real SDKs against Azurite 3.37.0 and S3rver 3.7.1. It verifies multipart/block uploads, checksums, scoped SAS, rejection/cancellation/timeouts, cleanup, manual and scheduled Azure backups, private restore files and retention. S3rver allows anonymous reads and omits conditional PUT semantics; the fixture supplies those boundaries and verifies the SDK sends the correct requests. It is not evidence of a live AWS/R2 account policy.

For a real-provider smoke check, use a dedicated disposable private bucket/container:

1. Save and test the provider in Settings; check the temporary object was removed and credentials are absent from page props.
2. Create a manual backup larger than 6 MiB. Confirm its size/checksum and restore it to a disposable database, then check actual database content.
3. Enable a schedule, let it create backups past retention, and verify expired current objects disappear. Check historical-version lifecycle policy separately.
4. Switch to another private provider. Download/restore an older backup using its original location, then exercise retention or purge cleanup.
5. In the disposable location only, remove write/delete permission, expire a SAS, interrupt an upload, and make a test object publicly readable. Verify actionable errors, preserved records on failed deletion, and successful retry after restoring access.

Never use production data for the public-access smoke test. No live cloud account was used by the local emulator contract.
