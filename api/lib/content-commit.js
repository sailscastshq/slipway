const TRAILER = 'Slipway-Content-Change: true'

function withContentCommitTrailer(message) {
  const trimmed = String(message || '').trim()
  return `${trimmed}\n\n${TRAILER}`
}

function isContentCommit(message) {
  return String(message || '')
    .split(/\r?\n/)
    .some((line) => line.trim() === TRAILER)
}

module.exports = {
  TRAILER,
  isContentCommit,
  withContentCommitTrailer
}
