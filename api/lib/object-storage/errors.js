module.exports = function storageError(error) {
  const code = String(error?.code || error?.name || '')
  const status = error?.statusCode || error?.$metadata?.httpStatusCode
  const messages = {
    STREAM_SIZE_LIMIT: 'The backup exceeds the configured transfer size limit.',
    STREAM_TIMEOUT:
      'Object storage did not finish within the transfer deadline.',
    STREAM_ABORTED: 'The object storage operation was cancelled.',
    STORAGE_PUBLIC:
      'This container or bucket allows anonymous reads. Use private storage for backups.',
    STORAGE_PRIVACY_UNVERIFIED:
      'Private object access could not be verified. Check the endpoint and bucket access policy.',
    STORAGE_INTEGRITY: 'The stored object did not match the uploaded content.',
    STORAGE_CONFIGURATION: 'Complete the selected object storage configuration.'
  }
  let normalized = code
  if (
    !messages[normalized] &&
    ![
      'STORAGE_AUTHENTICATION',
      'STORAGE_AUTHORIZATION',
      'STORAGE_QUOTA',
      'STORAGE_ENDPOINT',
      'STORAGE_NETWORK'
    ].includes(normalized)
  ) {
    normalized = /AbortError|ABORT_ERR/.test(code)
      ? 'STREAM_ABORTED'
      : /Authentication|InvalidAccessKey|Signature|InvalidAuthentication|Credentials/.test(
          code
        ) || status === 401
      ? 'STORAGE_AUTHENTICATION'
      : /AccessDenied|Authorization|Permission/.test(code) || status === 403
      ? 'STORAGE_AUTHORIZATION'
      : /Quota|ContainerBeingDeleted|StorageAccountIsDisabled/.test(code) ||
        status === 429 ||
        status === 507
      ? 'STORAGE_QUOTA'
      : /NoSuchBucket|ContainerNotFound|InvalidUri|InvalidEndpoint|ENOTFOUND/.test(
          code
        ) || status === 404
      ? 'STORAGE_ENDPOINT'
      : 'STORAGE_NETWORK'
  }
  const result = new Error(
    messages[normalized] ||
      {
        STORAGE_AUTHENTICATION:
          'Object storage rejected the credentials. Check or rotate the key or SAS token.',
        STORAGE_AUTHORIZATION:
          'Object storage denied access. Grant private object read, write, and delete permissions.',
        STORAGE_QUOTA:
          'Object storage is unavailable because of a quota or account limit. Check the provider account.',
        STORAGE_ENDPOINT:
          'The storage endpoint or container/bucket could not be found. Verify its address and name.',
        STORAGE_NETWORK:
          'Object storage could not be reached or did not complete the request. Check connectivity and retry.'
      }[normalized]
  )
  result.code = normalized
  if (error?.cleanupFailed) {
    result.cleanupFailed = true
    result.message +=
      ' Temporary object cleanup could not be confirmed; check storage before retrying.'
  }
  return result
}
