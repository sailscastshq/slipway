const { test } = require('sounding')
const assert = require('node:assert/strict')
const {
  normalizeMediaPreview
} = require('../../../../api/lib/bridge-media-preview')
const video = {
  type: 'video',
  title: 'Recording',
  url: '/api/talk-assets/asset-1/preview'
}

test('Bridge server and client accept only bounded private app-relative video/PDF previews', async () => {
  const client = await import(
    '../../../../assets/js/lib/bridge/media-preview.mjs'
  )
  for (const type of ['video', 'pdf']) {
    assert.deepEqual(normalizeMediaPreview({ ...video, type }), {
      ...video,
      type
    })
    assert.deepEqual(
      client.normalizeMediaPreview({ ...video, type, id: 'flash-id' }),
      { ...video, type }
    )
  }
  for (const url of [
    'https://storage.test/secret',
    '//storage.test/x',
    'javascript:alert(1)',
    'data:text/html,x',
    '/api/x?token=secret',
    '/api/x#fragment',
    '/../admin',
    '/api/./x',
    '/api//x',
    '/api/%2e%2e/x',
    '/api\\x',
    '/api/\nx'
  ]) {
    assert.equal(normalizeMediaPreview({ ...video, url }), null)
    assert.equal(client.normalizeMediaPreview({ ...video, url }), null)
  }
  for (const invalid of [
    { ...video, type: 'html' },
    { ...video, type: 'pptx' },
    { ...video, html: '<h1>x</h1>' },
    { ...video, title: 'x'.repeat(513) },
    { ...video, title: '' }
  ]) {
    assert.equal(normalizeMediaPreview(invalid), null)
    assert.equal(client.normalizeMediaPreview(invalid), null)
  }
})

test('Bridge preview checks credentials, MIME and access without accepting redirects or external URLs', async () => {
  const { authorizeMediaPreview } = await import(
    '../../../../assets/js/lib/bridge/media-preview.mjs'
  )
  const requests = []
  const request = async (url, options) => {
    requests.push({ url, options })
    return { ok: true, headers: new Headers({ 'Content-Type': 'video/webm' }) }
  }
  await authorizeMediaPreview(video, undefined, request)
  assert.equal(requests[0].options.method, 'HEAD')
  assert.equal(requests[0].options.credentials, 'same-origin')
  assert.equal(requests[0].options.redirect, 'error')
  assert.equal(requests[0].options.cache, 'no-store')
  for (const response of [
    { ok: false, headers: new Headers({ 'Content-Type': 'video/webm' }) },
    { ok: true, headers: new Headers({ 'Content-Type': 'text/html' }) },
    { ok: true, headers: new Headers({ 'Content-Type': 'application/pdf' }) }
  ])
    await assert.rejects(
      authorizeMediaPreview(video, undefined, async () => response),
      /unavailable/
    )
  await assert.rejects(
    authorizeMediaPreview(
      { ...video, url: 'https://external.test/x' },
      undefined,
      request
    ),
    /Unsupported/
  )
  assert.equal(requests.length, 1)
})

test('Bridge execution preserves validated media previews and rejects unsafe action results', async ({
  sails
}) => {
  const originals = { ...sails.helpers.bridge }
  let result = { preview: video }
  sails.helpers.bridge.buildSailsWrapper = async (code) => code
  sails.helpers.bridge.executeInContainer = async (_, code) => ({
    success: true,
    output: JSON.stringify(
      await new Function('sails', `return(async()=>{${code}})()`)({
        helpers: { bridge: { preview: { with: async () => result } } }
      })
    )
  })
  const input = {
    containerName: 'fixture',
    resource: { identity: 'proposal', primaryKey: 'id' },
    action: { name: 'watch', helper: 'bridge.preview', fields: {} },
    actor: { id: 5 },
    values: {},
    recordId: '1'
  }
  try {
    assert.deepEqual(
      (await originals.executeCustomAction.with(input)).preview,
      video
    )
    result = { message: 'Still ordinary' }
    assert.deepEqual(await originals.executeCustomAction.with(input), {
      message: 'Still ordinary'
    })
    result = { preview: { ...video, url: 'https://external.test/x' } }
    await assert.rejects(
      originals.executeCustomAction.with(input),
      /unsupported media preview/
    )
  } finally {
    Object.assign(sails.helpers.bridge, originals)
  }
})

test('PDF previews bind verified bytes to PDF MIME and bound downloads with or without Content-Length', async () => {
  const { loadPdfPreview } = await import(
    '../../../../assets/js/lib/bridge/media-preview.mjs'
  )
  const pdf = { ...video, type: 'pdf' }
  const url = await loadPdfPreview(
    pdf,
    undefined,
    async () =>
      new Response('%PDF-1.4\nfixture', {
        headers: { 'Content-Type': 'application/pdf' }
      })
  )
  assert(url.startsWith('blob:'))
  URL.revokeObjectURL(url)
  await assert.rejects(
    loadPdfPreview(
      pdf,
      undefined,
      async () =>
        new Response('<script>bad</script>', {
          headers: { 'Content-Type': 'application/pdf' }
        })
    ),
    /Invalid PDF/
  )
  await assert.rejects(
    loadPdfPreview(
      pdf,
      undefined,
      async () =>
        new Response('x', {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Length': String(65 * 1024 ** 2)
          }
        })
    ),
    /64 MiB/
  )
  let cancelled = false
  const chunk = new Uint8Array(1024 ** 2)
  await assert.rejects(
    loadPdfPreview(
      pdf,
      undefined,
      async () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(chunk)
            },
            cancel() {
              cancelled = true
            }
          }),
          { headers: { 'Content-Type': 'application/pdf' } }
        )
    ),
    /64 MiB/
  )
  assert(cancelled)
})
