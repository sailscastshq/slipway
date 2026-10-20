export function normalizeMediaPreview(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (key) => !['type', 'title', 'url', 'id'].includes(key)
    ) ||
    !['video', 'pdf'].includes(value.type) ||
    typeof value.title !== 'string' ||
    !value.title.trim() ||
    value.title.length > 512 ||
    typeof value.url !== 'string' ||
    value.url.length > 2048 ||
    !/^\/(?!\/)[A-Za-z0-9/_~.-]+$/.test(value.url) ||
    value.url
      .split('/')
      .slice(1)
      .some((segment) => !segment || ['.', '..'].includes(segment))
  )
    return null
  return {
    type: value.type,
    title: value.title.trim().slice(0, 120),
    url: value.url
  }
}

export async function authorizeMediaPreview(preview, signal, request = fetch) {
  preview = normalizeMediaPreview(preview)
  if (!preview) throw new Error('Unsupported media preview.')
  const response = await request(preview.url, {
    method: 'HEAD',
    credentials: 'same-origin',
    redirect: 'error',
    cache: 'no-store',
    signal
  })
  const type = (response.headers.get('Content-Type') || '')
    .split(';')[0]
    .trim()
    .toLowerCase()
  if (
    !response.ok ||
    !(preview.type === 'pdf'
      ? type === 'application/pdf'
      : ['video/mp4', 'video/webm'].includes(type))
  )
    throw new Error('This material is unavailable or your access has expired.')
}

// Native PDF plugins do not render in a script-disabled iframe sandbox. Bind
// verified bytes to a PDF MIME type rather than framing a mutable app response.
export async function loadPdfPreview(preview, signal, request = fetch) {
  preview = normalizeMediaPreview(preview)
  if (!preview || preview.type !== 'pdf')
    throw new Error('Unsupported PDF preview.')
  const response = await request(preview.url, {
    credentials: 'same-origin',
    redirect: 'error',
    cache: 'no-store',
    signal
  })
  if (
    !response.ok ||
    (response.headers.get('Content-Type') || '')
      .split(';')[0]
      .trim()
      .toLowerCase() !== 'application/pdf'
  )
    throw new Error('PDF unavailable.')
  const limit = 64 * 1024 * 1024
  if (Number(response.headers.get('Content-Length')) > limit) {
    await response.body?.cancel()
    throw new Error('PDF exceeds the 64 MiB preview limit.')
  }
  const reader = response.body.getReader(),
    chunks = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        await reader.cancel()
        throw new Error('PDF exceeds the 64 MiB preview limit.')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const blob = new Blob(chunks, { type: 'application/pdf' })
  if ((await blob.slice(0, 5).text()) !== '%PDF-')
    throw new Error('Invalid PDF bytes.')
  return URL.createObjectURL(blob)
}
