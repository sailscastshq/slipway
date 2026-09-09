import { getCredentials, isLoggedIn } from './config.js'

export class APIError extends Error {
  constructor(message, statusCode, body) {
    super(message)
    this.name = 'APIError'
    this.statusCode = statusCode
    this.body = body
  }
}

async function apiRequest(method, path, options = {}) {
  if (!isLoggedIn()) {
    throw new Error('Not logged in. Run `slipway login` first.')
  }

  const { server, token } = getCredentials()
  const url = `${server}/api/v1${path}`

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`
  }

  const fetchOptions = {
    method,
    signal: AbortSignal.timeout(30000),
    headers
  }

  if (options.body) {
    fetchOptions.body = JSON.stringify(options.body)
  }

  try {
    const response = await fetch(url, fetchOptions)
    const text = await response.text()

    let body
    try {
      body = JSON.parse(text)
    } catch {
      if (!response.ok) {
        throw new APIError(
          text || `Request failed with status ${response.status}`,
          response.status
        )
      }
      throw new APIError(
        `Unexpected response from server: ${text}`,
        response.status
      )
    }

    if (!response.ok) {
      const message =
        body.message ||
        body.error ||
        `Request failed with status ${response.status}`
      throw new APIError(message, response.status, body)
    }

    return body
  } catch (error) {
    if (error instanceof APIError) {
      throw error
    }
    if (error.name === 'TimeoutError')
      throw new Error(
        'Slipway request timed out after 30 seconds. Check the server before retrying a change.'
      )
    throw new Error(`Failed to connect to Slipway server: ${error.message}`)
  }
}

/**
 * Upload a file as multipart form data.
 * Used by `slipway slide` to push source tarballs.
 */
async function apiUpload(path, fieldName, buffer, filename) {
  if (!isLoggedIn()) {
    throw new Error('Not logged in. Run `slipway login` first.')
  }

  const { server, token } = getCredentials()
  const url = `${server}/api/v1${path}`

  const formData = new FormData()
  formData.append(fieldName, new Blob([buffer]), filename)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Slipway-Source-Protocol': '2'
      },
      signal: AbortSignal.timeout(120000),
      body: formData
    })

    const text = await response.text()

    let body
    try {
      body = JSON.parse(text)
    } catch {
      if (!response.ok) {
        throw new APIError(
          text || `Upload failed with status ${response.status}`,
          response.status
        )
      }
      throw new APIError(
        `Unexpected response from server: ${text}`,
        response.status
      )
    }

    if (!response.ok) {
      const message =
        body.message ||
        body.error ||
        `Upload failed with status ${response.status}`
      throw new APIError(message, response.status, body)
    }

    return body
  } catch (error) {
    if (error instanceof APIError) {
      throw error
    }
    if (error.name === 'TimeoutError')
      throw new Error(
        'Slipway upload timed out after 2 minutes. Check the project before retrying.'
      )
    throw new Error(`Failed to upload to Slipway server: ${error.message}`)
  }
}

// Convenience methods
export const api = {
  get: (path) => apiRequest('GET', path),
  post: (path, body) => apiRequest('POST', path, { body }),
  patch: (path, body) => apiRequest('PATCH', path, { body }),
  delete: (path) => apiRequest('DELETE', path),
  upload: apiUpload
}

// Project endpoints
api.projects = {
  list: () => api.get('/projects'),
  create: (data) => api.post('/projects', data),
  get: (id) => api.get(`/projects/${id}`),
  update: (id, data) => api.patch(`/projects/${id}`, data),
  delete: (id) => api.delete(`/projects/${id}`),
  push: (id, tarballBuffer) => pushSource(id, tarballBuffer)
}

// Environment endpoints
api.environments = {
  readiness: (project, env = 'production', app) =>
    api.get(
      `/projects/${encodeURIComponent(
        project
      )}/environments/${encodeURIComponent(env)}/readiness${
        app ? `?app=${encodeURIComponent(app)}` : ''
      }`
    ),
  list: (projectId) => api.get(`/projects/${projectId}/environments`),
  create: (projectId, data) =>
    api.post(`/projects/${projectId}/environments`, data),
  get: (projectId, id) => api.get(`/projects/${projectId}/environments/${id}`),
  update: (projectId, id, data) =>
    api.patch(`/projects/${projectId}/environments/${id}`, data),
  delete: (projectId, id) =>
    api.delete(`/projects/${projectId}/environments/${id}`)
}

// Deployment endpoints
api.deployments = {
  trigger: (projectId, environmentId, data) =>
    api.post(
      `/projects/${projectId}/environments/${environmentId}/deploy`,
      data
    ),
  status: (id) => api.get(`/deployments/${id}`),
  logs: (id, type = 'all') => api.get(`/deployments/${id}/logs?type=${type}`)
}

// Service endpoints
api.services = {
  list: (projectId, environmentId) =>
    api.get(`/projects/${projectId}/environments/${environmentId}/services`),
  create: (projectId, environmentId, data) =>
    api.post(
      `/projects/${projectId}/environments/${environmentId}/services`,
      data
    ),
  get: (id) => api.get(`/services/${id}`),
  delete: (id) => api.delete(`/services/${id}`)
}

// Backup endpoints
api.backups = {
  create: (serviceId) => api.post(`/services/${serviceId}/backups`),
  list: (serviceId) => api.get(`/services/${serviceId}/backups`),
  restore: (backupId) =>
    api.post(`/backups/${backupId}/restore`, { writesPaused: true })
}

// Audit log endpoints
api.auditLogs = {
  list: (page = 1, limit = 20) =>
    api.get(`/audit-logs?page=${page}&limit=${limit}`)
}

async function pushSource(id, tarballBuffer) {
  let result = await api.upload(
    `/projects/${id}/push`,
    'source',
    tarballBuffer,
    'source.tar.gz'
  )
  if (!result.operation) return result
  const operationId = result.operation.id
  const deadline = Date.now() + 10 * 60 * 1000
  while (['queued', 'running'].includes(result.operation.status)) {
    if (Date.now() > deadline)
      throw new Error(
        `Source operation ${operationId} is still pending. Check /api/v1/source-operations/${operationId} before uploading again.`
      )
    await new Promise((resolve) => setTimeout(resolve, 750))
    result = await api.get(`/source-operations/${operationId}`)
  }
  if (result.operation.status !== 'completed')
    throw new Error(
      `Source operation ${operationId}: ${
        result.operation.error || result.operation.status
      }`
    )
  return { sourceRevision: result.operation.sourceRevision }
}
