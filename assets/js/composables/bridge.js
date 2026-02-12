import { usePage } from '@inertiajs/vue3'

export function useBridge() {
  const page = usePage()

  function basePath() {
    const { project, environment } = page.props
    return `/api/v1/projects/${project.slug}/environments/${environment.slug}/bridge`
  }

  function headers(extra = {}) {
    return {
      'Content-Type': 'application/json',
      'x-csrf-token': page.props._csrf || '',
      ...extra
    }
  }

  async function request(url, options = {}) {
    const res = await fetch(url, {
      headers: headers(),
      ...options
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.message || body.error || `Request failed (${res.status})`)
    }
    return res.json()
  }

  async function fetchModels() {
    return request(`${basePath()}/models`)
  }

  async function fetchRecords(model, { page: pg = 1, perPage = 20, sort = 'createdAt DESC', search = '' } = {}) {
    const params = new URLSearchParams({ model, page: pg, perPage, sort })
    if (search) params.set('search', search)
    return request(`${basePath()}/records?${params}`)
  }

  async function fetchRecord(model, recordId) {
    const params = new URLSearchParams({ model, recordId })
    return request(`${basePath()}/record?${params}`)
  }

  async function createRecord(model, values) {
    return request(`${basePath()}/record`, {
      method: 'POST',
      body: JSON.stringify({ model, values })
    })
  }

  async function updateRecord(model, recordId, values) {
    return request(`${basePath()}/record`, {
      method: 'PATCH',
      body: JSON.stringify({ model, recordId, values })
    })
  }

  async function destroyRecord(model, recordId) {
    return request(`${basePath()}/record`, {
      method: 'DELETE',
      body: JSON.stringify({ model, recordId })
    })
  }

  async function bulkDestroy(model, ids) {
    return request(`${basePath()}/records/bulk-destroy`, {
      method: 'POST',
      body: JSON.stringify({ model, ids })
    })
  }

  return {
    fetchModels,
    fetchRecords,
    fetchRecord,
    createRecord,
    updateRecord,
    destroyRecord,
    bulkDestroy
  }
}
