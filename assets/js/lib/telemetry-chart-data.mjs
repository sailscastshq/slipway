export function toPercentChartData(
  samples,
  valueKey,
  timestampKey,
  formatTime
) {
  return (samples || []).map((sample) => {
    const rawValue = sample[valueKey]
    const value =
      rawValue === null || rawValue === '' ? undefined : Number(rawValue)
    const timestamp = sample[timestampKey]
    const label =
      timestamp === undefined || timestamp === null ? '' : formatTime(timestamp)
    const formattedValue = Number.isFinite(value)
      ? `${value.toFixed(1)}%`
      : 'sample unavailable'

    return {
      label,
      value: Number.isFinite(value) ? value : undefined,
      detail: label ? `${label}, ${formattedValue}` : formattedValue
    }
  })
}
