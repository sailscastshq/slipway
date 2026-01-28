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
    const body = await response.json()

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

// Convenience methods
export const api = {
  get: (path) => apiRequest('GET', path),
  post: (path, body) => apiRequest('POST', path, { body }),
  patch: (path, body) => apiRequest('PATCH', path, { body }),
  delete: (path) => apiRequest('DELETE', path)
}

// Project endpoints
api.projects = {
  list: () => api.get('/projects'),
  create: (data) => api.post('/projects', data),
  get: (id) => api.get(`/projects/${id}`),
  update: (id, data) => api.patch(`/projects/${id}`, data),
  delete: (id) => api.delete(`/projects/${id}`)
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
