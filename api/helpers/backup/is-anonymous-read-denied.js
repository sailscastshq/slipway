module.exports = {
  friendlyName: 'Is anonymous storage read denied',
  sync: true,
  inputs: {
    endpoint: { type: 'string', required: true },
    status: { type: 'number', required: true },
    providerCode: { type: 'string' },
    authorizationRequired: { type: 'boolean' }
  },
  exits: { success: { outputType: 'boolean' } },
  fn: ({ endpoint, status, providerCode, authorizationRequired }) => {
    if ([401, 403, 404].includes(status)) return true
    // R2's S3 API rejects unsigned requests with this exact 400 response.
    // This establishes denial at this endpoint, not at other public aliases.
    const url = new URL(endpoint)
    return (
      url.protocol === 'https:' &&
      url.hostname.endsWith('.r2.cloudflarestorage.com') &&
      status === 400 &&
      providerCode === 'InvalidArgument' &&
      authorizationRequired === true
    )
  }
}
