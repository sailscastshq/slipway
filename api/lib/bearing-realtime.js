const crypto = require('node:crypto')

const BEARING_FEEDBACK_EVENT = 'bearing:feedback'
const BEARING_UPDATE_EVENT = 'bearing:update'
const REALTIME_TOKEN_TTL_MS = 24 * 60 * 60 * 1000

function issueRealtimeToken({
  spaceId,
  origin,
  secret,
  ttlMs = REALTIME_TOKEN_TTL_MS
}) {
  const payload = {
    version: 1,
    spaceId: String(spaceId),
    origin: normalizeOrigin(origin),
    expiresAt: Date.now() + ttlMs
  }
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    'base64url'
  )
  return `${encodedPayload}.${sign(encodedPayload, secret)}`
}

function verifyRealtimeToken({ token, origin, secret }) {
  const [encodedPayload, presentedSignature, ...rest] = String(
    token || ''
  ).split('.')
  if (!encodedPayload || !presentedSignature || rest.length) return null

  const expectedSignature = sign(encodedPayload, secret)
  if (!safeEqual(presentedSignature, expectedSignature)) return null

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8')
    )
    if (
      payload.version !== 1 ||
      !payload.spaceId ||
      payload.expiresAt <= Date.now() ||
      payload.origin !== normalizeOrigin(origin)
    ) {
      return null
    }
    return payload
  } catch {
    return null
  }
}

function authorizeSocketHandshake({ handshake, controlPlaneOrigin, secret }) {
  const origin = normalizeOrigin(handshake?.headers?.origin)
  if (!origin) return true
  if (origin === normalizeOrigin(controlPlaneOrigin)) return true

  const token =
    handshake?.query?.bearingRealtimeToken ||
    handshake?._query?.bearingRealtimeToken ||
    handshake?.headers?.['x-bearing-realtime-token']

  return Boolean(verifyRealtimeToken({ token, origin, secret }))
}

function roomName(spaceId) {
  return `bearing:space:${String(spaceId)}`
}

function buildRealtimeConfig({
  req,
  resolved,
  projectSlug,
  environmentSlug,
  appSlug,
  secret
}) {
  const origin = requestOrigin(req)
  return {
    token: issueRealtimeToken({
      spaceId: resolved.space.id,
      origin,
      secret
    }),
    socketPath: resolved.integrationBasePath
      ? `${resolved.integrationBasePath}/socket.io`
      : '/socket.io',
    subscribePath: `/bearing/public/${encodeURIComponent(
      projectSlug
    )}/${encodeURIComponent(environmentSlug)}/${encodeURIComponent(
      appSlug
    )}/realtime`
  }
}

function serializeFeedback(item, options = {}) {
  return {
    publicId: item.publicId,
    title: item.title,
    details: item.details,
    images: Array.isArray(item.images)
      ? item.images.map((image) => ({
          url: image.url,
          type: image.type,
          size: image.size
        }))
      : [],
    category: item.category,
    status: item.status,
    voteCount: item.voteCount,
    ...(Object.prototype.hasOwnProperty.call(options, 'viewerHasVoted')
      ? { viewerHasVoted: options.viewerHasVoted === true }
      : {}),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    authorName: item.submittedAnonymously
      ? 'Anonymous'
      : item.author?.displayName || item.authorName || 'A customer'
  }
}

function serializeUpdate(item) {
  return {
    publicId: item.publicId,
    title: item.title,
    slug: item.slug,
    excerpt: item.excerpt,
    body: item.body,
    status: item.status,
    publishedAt: item.publishedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    authorName: item.author?.fullName || item.authorName || 'The team',
    linkedFeedback: (item.linkedFeedback || []).map((feedback) => ({
      publicId: feedback.publicId,
      title: feedback.title
    }))
  }
}

function normalizeOrigin(value) {
  try {
    return new URL(String(value || '')).origin.toLowerCase()
  } catch {
    return ''
  }
}

function requestOrigin(req) {
  const protocol = req.get('x-forwarded-proto') || req.protocol || 'https'
  const host = req.get('x-forwarded-host') || req.get('host')
  return normalizeOrigin(`${protocol}://${host}`)
}

function sign(value, secret) {
  return crypto
    .createHmac('sha256', String(secret || ''))
    .update(value)
    .digest('base64url')
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''))
  const rightBuffer = Buffer.from(String(right || ''))
  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  )
}

module.exports = {
  BEARING_FEEDBACK_EVENT,
  BEARING_UPDATE_EVENT,
  authorizeSocketHandshake,
  buildRealtimeConfig,
  issueRealtimeToken,
  normalizeOrigin,
  roomName,
  serializeFeedback,
  serializeUpdate,
  verifyRealtimeToken
}
