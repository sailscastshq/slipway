export function normalizeChip(value, items = { type: 'text' }) {
  const text = String(value).trim()
  if (items.type !== 'currency') {
    if (!text || text.length > 1000)
      throw new Error('Enter between 1 and 1000 characters.')
    return text
  }
  const digits = items.currency?.maximumFractionDigits ?? 2
  const match = text.match(/^(\d+)(?:\.(\d+))?$/)
  if (text.length > 40 || !match || (match[2]?.length || 0) > digits)
    throw new Error(
      `Enter a positive amount with at most ${digits} decimal places.`
    )
  const minor =
    BigInt(match[1]) * 10n ** BigInt(digits) +
    BigInt((match[2] || '').padEnd(digits, '0') || '0')
  if (minor <= 0n || minor > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error('Enter a positive amount within the supported range.')
  return minorToMajor(String(minor), digits)
}
export function minorToMajor(value, digits) {
  const text = String(value)
  if (!/^\d+$/.test(text)) return text
  if (!digits) return text
  const padded = text.padStart(digits + 1, '0')
  return `${padded.slice(0, -digits)}.${padded.slice(-digits)}`.replace(
    /\.?0+$/,
    ''
  )
}
export function chipsInputValue(value, items) {
  if (!Array.isArray(value)) return []
  return value.map((item) =>
    items?.type === 'currency' && items.currency?.storage === 'minor'
      ? minorToMajor(item, items.currency.maximumFractionDigits ?? 2)
      : String(item)
  )
}
