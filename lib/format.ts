// Indian-numbering formatting helpers used across the app.

/** Full INR amount with Indian digit grouping, e.g. ₹6,17,308.00 */
export function formatINR(value: number, fractionDigits = 2): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value)
}

/** Compact lakh/crore notation used on dashboard cards, e.g. ₹21.70 L, ₹1.2 Cr */
export function formatLakh(value: number): string {
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  if (abs >= 1_00_00_000) return `${sign}₹${(abs / 1_00_00_000).toFixed(2)} Cr`
  if (abs >= 1_00_000) return `${sign}₹${(abs / 1_00_000).toFixed(2)} L`
  if (abs >= 1_000) return `${sign}₹${(abs / 1_000).toFixed(0)} K`
  return `${sign}₹${abs.toFixed(0)}`
}

/** Axis-friendly lakh label without decimals padding, e.g. ₹4.5 L, ₹0 */
export function formatAxisLakh(value: number): string {
  if (value === 0) return '₹0'
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  if (abs >= 1_00_000) return `${sign}₹${(abs / 1_00_000).toFixed(1)} L`
  if (abs >= 1_000) return `${sign}₹${(abs / 1_000).toFixed(0)} K`
  return `${sign}₹${abs}`
}

export function formatPercent(value: number): string {
  const sign = value > 0 ? '↑ ' : value < 0 ? '↓ ' : ''
  return `${sign}${Math.abs(value).toFixed(2)}%`
}
