export function apiErrorMessage(data, fallback) {
  return (
    [data?.error, data?.error?.message, data?.message].find(
      (message) => typeof message === 'string' && message.trim()
    ) || fallback
  )
}
