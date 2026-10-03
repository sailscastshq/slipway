import { router, usePage } from '@inertiajs/vue3'

function failure(message) {
  const error = new Error(message)
  error.mutationMessage = message
  return error
}
function httpFailure(response) {
  return failure(
    response.status === 403
      ? 'You no longer have permission to make this change.'
      : response.status === 401 || response.status === 419
      ? 'Your session expired. Sign in again in another tab, then retry.'
      : response.data?.props?.message ||
        response.data?.message ||
        `The save could not be confirmed (${response.status}). Your edits are still here.`
  )
}

// Await completion so callers can sequence save/restart and retain local edits.
export function inertiaMutation(method, url, data = {}, options = {}) {
  const component = usePage().component
  return new Promise((resolve, reject) => {
    router.visit(url, {
      method,
      data,
      preserveScroll: true,
      preserveState: true,
      ...options,
      onSuccess: (page) => {
        if (page.component !== component)
          reject(
            failure(
              'The session or target changed before this save was confirmed. Check current settings before retrying.'
            )
          )
        else resolve(page)
      },
      onError: (errors) =>
        reject(
          failure(
            Object.values(errors).flat().join(' ') ||
              'The change could not be saved.'
          )
        ),
      onCancel: () =>
        reject(
          failure(
            'The save was cancelled. Check the current settings before retrying.'
          )
        ),
      onHttpException: (response) => {
        reject(httpFailure(response))
        return false
      },
      onNetworkError: () => {
        reject(
          failure(
            'Connection interrupted. Check the current settings before retrying.'
          )
        )
        return false
      }
    })
  })
}

export function submitInertiaForm(form, method, url) {
  const component = usePage().component
  return new Promise((resolve, reject) => {
    form[method](url, {
      preserveScroll: true,
      onSuccess: (page) => {
        if (page.component !== component)
          reject(
            failure(
              'The session or target changed before this save was confirmed. Check current settings before retrying.'
            )
          )
        else resolve(page)
      },
      onError: (errors) =>
        reject(
          failure(
            Object.values(errors).flat().join(' ') ||
              'The change could not be saved.'
          )
        ),
      onCancel: () =>
        reject(
          failure(
            'The save was cancelled. Check current settings before retrying.'
          )
        ),
      onHttpException: (response) => {
        reject(httpFailure(response))
        return false
      },
      onNetworkError: () => {
        reject(
          failure(
            'Connection interrupted. Check current settings before retrying.'
          )
        )
        return false
      }
    })
  })
}
