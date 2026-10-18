const crypto = require('node:crypto')
const { marked } = require('marked')
const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (ch) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[
        ch
      ])
  )
const emailHash = (email) =>
  crypto
    .createHash('sha256')
    .update(String(email).trim().toLowerCase())
    .digest('hex')

function url(value, base, image = false) {
  try {
    const parsed = new URL(value, base)
    return (image
      ? ['https:', 'http:']
      : ['https:', 'http:', 'mailto:']
    ).includes(parsed.protocol)
      ? parsed.href
      : null
  } catch {
    return null
  }
}
function render(body, base) {
  const tokens = marked.lexer(String(body))
  function inline(tokens = [], plain = false) {
    return tokens
      .map((t) => {
        if (t.type === 'link') {
          const href = url(t.href, base)
          const text = inline(t.tokens, plain)
          return !href
            ? text
            : plain
            ? `${text} (${href})`
            : `<a href="${escape(href)}" style="color:#2563eb">${text}</a>`
        }
        if (t.type === 'image') {
          const src = url(t.href, base, true)
          return plain
            ? `[Image: ${t.text || 'Image'}]${src ? ` (${src})` : ''}`
            : src
            ? `<img src="${escape(src)}" alt="${escape(
                t.text
              )}" style="display:block;max-width:100%;height:auto;margin:16px 0" />`
            : escape(t.text)
        }
        if (['strong', 'em', 'del'].includes(t.type)) {
          const text = inline(t.tokens, plain)
          return plain ? text : `<${t.type}>${text}</${t.type}>`
        }
        if (t.type === 'codespan')
          return plain
            ? t.text
            : `<code style="white-space:pre-wrap;overflow-wrap:anywhere">${escape(
                t.text
              )}</code>`
        if (t.type === 'br') return plain ? '\n' : '<br />'
        if (t.type === 'html') return raw(t.text, plain)
        return plain ? t.text || '' : escape(t.text || '')
      })
      .join('')
  }
  function raw(text, plain) {
    if (/<(?:iframe|video|audio|object|embed)\b/i.test(text)) {
      const links = [...text.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)]
        .map((match) => url(match[1], base))
        .filter(Boolean)
      return plain
        ? `Embedded content${links.length ? ': ' + links.join(', ') : ''}`
        : `<p>Embedded content${links
            .map(
              (href) => `: <a href="${escape(href)}">View embedded content</a>`
            )
            .join('')}</p>`
    }
    return plain
      ? text
      : `<pre style="white-space:pre-wrap;overflow-wrap:anywhere">${escape(
          text
        )}</pre>`
  }
  function blocks(tokens, plain = false) {
    return tokens
      .map((t) => {
        const text = t.tokens
          ? inline(t.tokens, plain)
          : plain
          ? t.text || ''
          : escape(t.text || '')
        if (t.type === 'space') return ''
        if (t.type === 'html') return raw(t.text, plain)
        if (t.type === 'heading')
          return plain
            ? `${text}\n\n`
            : `<h${t.depth} style="line-height:1.3;margin:24px 0 12px">${text}</h${t.depth}>`
        if (t.type === 'code')
          return plain
            ? `${t.text}\n\n`
            : `<pre style="white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f4f5;padding:16px"><code>${escape(
                t.text
              )}</code></pre>`
        if (t.type === 'blockquote')
          return plain
            ? blocks(t.tokens, true)
            : `<blockquote style="border-left:3px solid #d4d4d8;padding-left:16px;margin-left:0">${blocks(
                t.tokens
              )}</blockquote>`
        if (t.type === 'list')
          return plain
            ? t.items
                .map(
                  (item, i) =>
                    `${t.ordered ? i + (t.start || 1) + '.' : '-'} ${blocks(
                      item.tokens,
                      true
                    ).trim()}\n`
                )
                .join('') + '\n'
            : `<${t.ordered ? 'ol' : 'ul'}>${t.items
                .map((item) => `<li>${blocks(item.tokens)}</li>`)
                .join('')}</${t.ordered ? 'ol' : 'ul'}>`
        if (t.type === 'table') {
          const rows = [t.header, ...t.rows].map((row) =>
            row.map((cell) => inline(cell.tokens, plain))
          )
          return plain
            ? rows.map((row) => row.join(' | ')).join('\n') + '\n\n'
            : `<table style="border-collapse:collapse;width:100%">${rows
                .map(
                  (row, i) =>
                    `<tr>${row
                      .map(
                        (cell) =>
                          `<${
                            i ? 'td' : 'th'
                          } style="padding:8px;border:1px solid #d4d4d8;text-align:left">${cell}</${
                            i ? 'td' : 'th'
                          }>`
                      )
                      .join('')}</tr>`
                )
                .join('')}</table>`
        }
        if (t.type === 'hr') return plain ? '---\n\n' : '<hr />'
        if (t.type === 'text' && t.tokens) return plain ? text : text
        return plain
          ? text + '\n\n'
          : `<p style="line-height:1.7;margin:0 0 16px">${text}</p>`
      })
      .join('')
  }
  return { html: blocks(tokens), text: blocks(tokens, true) }
}
function token(consent, secret) {
  return `${consent.id}.${crypto
    .createHmac('sha256', secret)
    .update(
      `bearing-update-unsubscribe:${consent.id}:${consent.participant}:${consent.space}:${consent.emailHash}`
    )
    .digest('base64url')}`
}
function validToken(value, consent, secret) {
  const expected = Buffer.from(token(consent, secret))
  const actual = Buffer.from(String(value))
  return (
    expected.length === actual.length &&
    crypto.timingSafeEqual(expected, actual)
  )
}
async function latest(participantId, connection) {
  let query = BearingUpdateConsent.find({ participant: participantId })
    .sort('id DESC')
    .limit(1)
  if (connection) query = query.usingConnection(connection)
  return (await query)[0] || null
}
async function preference(participant) {
  if (!participant || participant.disabledAt || !participant.emailVerifiedAt)
    return false
  const consent = await latest(participant.id)
  if (consent?.state !== 'on') return false
  const verified = await BearingParticipant.findOne({
    id: participant.id
  }).decrypt()
  return consent.emailHash === emailHash(verified.email)
}
async function recordPublication(update, resolved, connection) {
  const audience = await BearingUpdateConsent.find({ space: update.space })
    .sort('id DESC')
    .limit(1)
    .usingConnection(connection)
  const appUrl = await sails.helpers.bridge.getAppUrl.with({
    app: resolved.app,
    environment: resolved.environment,
    project: resolved.project
  })

  await BearingUpdatePublication.create({
    publicationKey: `update:${update.id}`,
    bearingUpdate: update.id,
    space: update.space,
    consentWatermark: audience[0]?.id || 0,
    snapshot: {
      title: update.title,
      body: update.body,
      appName: resolved.project.name,
      publishedAt: update.publishedAt,
      publicUrl: /^https?:\/\//.test(appUrl || '')
        ? `${appUrl.replace(/\/$/, '')}/bearing/updates/p/${encodeURIComponent(
            update.slug
          )}`
        : null
    }
  }).usingConnection(connection)
}
module.exports = {
  render,
  url,
  escape,
  emailHash,
  token,
  validToken,
  latest,
  preference,
  recordPublication
}
