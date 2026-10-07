import { usePage } from '@inertiajs/vue3'

// A reveal is deliberately separate from cached page props and mutation forms.
export function useSecretReveal() {
  const page = usePage()
  return async (scope, id, key) => {
    const response = await fetch('/api/v1/configuration/reveal', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': page.props._csrf
      },
      body: JSON.stringify({ scope, id: String(id), key })
    })
    if (!response.ok)
      throw new Error(
        'Could not reveal this value. Administrator access and a saved audit are required.'
      )
    return (await response.json()).value
  }
}
