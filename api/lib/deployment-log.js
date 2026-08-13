const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z(?:\s|$)/

/**
 * Append one captured stdout/stderr chunk while giving every new logical line
 * one canonical occurrence time. A line split across chunks keeps the
 * timestamp written with its first fragment.
 *
 * Existing untimestamped history is intentionally left alone. If it ends in a
 * partial line, the first fragment of the new chunk remains part of that
 * historical line rather than receiving a fabricated time.
 */
function appendTimestampedChunk(currentValue, chunkValue, occurredAt) {
  const current = String(currentValue || '')
  const chunk = String(chunkValue || '')
  if (!chunk) return current

  const timestamp = String(occurredAt || new Date().toISOString())
  let output = current
  let cursor = 0
  let atLineStart = current.length === 0 || current.endsWith('\n')

  while (cursor < chunk.length) {
    const newlineIndex = chunk.indexOf('\n', cursor)

    // Preserve deliberate spacing without turning an empty line into a
    // timestamp-only log event.
    if (atLineStart && newlineIndex === cursor) {
      output += '\n'
      cursor += 1
      continue
    }

    if (atLineStart) {
      const remainder = chunk.slice(cursor)
      if (!ISO_TIMESTAMP_PATTERN.test(remainder)) output += `${timestamp} `
      atLineStart = false
    }

    if (newlineIndex === -1) {
      output += chunk.slice(cursor)
      break
    }

    output += chunk.slice(cursor, newlineIndex + 1)
    cursor = newlineIndex + 1
    atLineStart = true
  }

  return output
}

module.exports = { appendTimestampedChunk }
