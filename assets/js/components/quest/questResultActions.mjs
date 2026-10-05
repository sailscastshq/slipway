// The result endpoint has already sanitized this retained value. Never rebuild
// it from a process receipt, logs, or a second/raw endpoint.
export function serializeQuestResult(result) {
  if (result?.status !== 'available' || !Object.hasOwn(result, 'value'))
    return null

  const seen = new Set()
  function validate(value) {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
    )
      return
    if (
      typeof value !== 'object' ||
      seen.has(value) ||
      (!Array.isArray(value) &&
        ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    )
      throw new Error('Not a retained JSON value')
    seen.add(value)
    const keys = Array.isArray(value)
      ? Array.from({ length: value.length }, (_, index) => index)
      : Object.keys(value)
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !Object.hasOwn(descriptor, 'value'))
        throw new Error('Not a retained JSON value')
      validate(descriptor.value)
    }
    seen.delete(value)
  }

  try {
    // JSON.stringify alone would silently omit undefined object properties or
    // replace unsupported array values/non-finite numbers with fabricated nulls.
    validate(result.value)
    return JSON.stringify(result.value, null, 2)
  } catch {
    return null
  }
}

export function downloadQuestResultJson(
  text,
  truncated = false,
  browser = globalThis
) {
  if (typeof text !== 'string') throw new Error('No retained JSON to export')
  const filename = `quest-result${truncated ? '-truncated' : ''}.json`
  const blob = new browser.Blob([text], {
    type: 'application/json;charset=utf-8'
  })
  const url = browser.URL.createObjectURL(blob)
  let link
  try {
    link = browser.document.createElement('a')
    link.href = url
    link.download = filename
    link.hidden = true
    browser.document.body.appendChild(link)
    link.click()
  } finally {
    link?.remove()
    // Keep the URL alive until the browser has consumed the click, then release
    // it even when starting the download failed.
    browser.setTimeout(() => browser.URL.revokeObjectURL(url), 0)
  }
  return filename
}
