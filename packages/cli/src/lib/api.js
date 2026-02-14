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
        throw new APIError(text || `Request failed with status ${response.status}`, response.status)
      }
      throw new APIError(`Unexpected response from server: ${text}`, response.status)
    }

    if (!response.ok) {
      const message = body.message || body.error || `Request failed with status ${response.status}`
      throw new APIError(message, response.status, body)
    }

    return body
  } catch (error) {
    if (error instanceof APIError) {
      throw error
    }
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
        Authorization: `Bearer ${token}`
      },
      body: formData
    })

    const text = await response.text()

    let body
    try {
      body = JSON.parse(text)
    } catch {
      if (!response.ok) {
        throw new APIError(text || `Upload failed with status ${response.status}`, response.status)
      }
      throw new APIError(`Unexpected response from server: ${text}`, response.status)
    }

    if (!response.ok) {
      const message = body.message || body.error || `Upload failed with status ${response.status}`
      throw new APIError(message, response.status, body)
    }

    return body
  } catch (error) {
    if (error instanceof APIError) {
      throw error
    }
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
  push: (id, tarballBuffer) => api.upload(`/projects/${id}/push`, 'source', tarballBuffer, 'source.tar.gz')
}

// Environment endpoints
api.environments = {
  list: (projectId) => api.get(`/projects/${projectId}/environments`),
  create: (projectId, data) => api.post(`/projects/${projectId}/environments`, data),
  get: (projectId, id) => api.get(`/projects/${projectId}/environments/${id}`),
  update: (projectId, id, data) => api.patch(`/projects/${projectId}/environments/${id}`, data),
  delete: (projectId, id) => api.delete(`/projects/${projectId}/environments/${id}`)
}

// Deployment endpoints
api.deployments = {
  trigger: (projectId, environmentId, data) =>
    api.post(`/projects/${projectId}/environments/${environmentId}/deploy`, data),
  status: (id) => api.get(`/deployments/${id}`),
  logs: (id, type = 'all') => api.get(`/deployments/${id}/logs?type=${type}`)
}

// Service endpoints
api.services = {
  list: (projectId, environmentId) =>
    api.get(`/projects/${projectId}/environments/${environmentId}/services`),
  create: (projectId, environmentId, data) =>
    api.post(`/projects/${projectId}/environments/${environmentId}/services`, data),
  get: (id) => api.get(`/services/${id}`),
  delete: (id) => api.delete(`/services/${id}`)
}

// Backup endpoints
api.backups = {
  create: (serviceId) => api.post(`/services/${serviceId}/backups`),
  list: (serviceId) => api.get(`/services/${serviceId}/backups`),
  restore: (backupId) => api.post(`/backups/${backupId}/restore`)
}

// Audit log endpoints
api.auditLogs = {
  list: (page = 1, limit = 20) => api.get(`/audit-logs?page=${page}&limit=${limit}`)
}
