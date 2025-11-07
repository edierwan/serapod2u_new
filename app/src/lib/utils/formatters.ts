/**
 * Number and Currency Formatters
 * Provides consistent formatting across the application
 */

/**
 * Format a number with thousand separators
 * @param value - The number to format
 * @param decimals - Number of decimal places (default: 0 for whole numbers)
 * @returns Formatted string with thousand separators
 * 
 * @example
 * formatNumber(1234567) // "1,234,567"
 * formatNumber(1234.5678, 2) // "1,234.57"
 * formatNumber(0) // "0"
 */
export function formatNumber(value: number | null | undefined, decimals: number = 0): string {
  if (value === null || value === undefined || isNaN(value)) {
    return '0'
  }

  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  })
}

/**
 * Format a number as currency (Malaysian Ringgit)
 * @param amount - The amount to format
 * @returns Formatted currency string
 * 
 * @example
 * formatCurrency(1234.56) // "RM 1,234.56"
 * formatCurrency(0) // "RM 0.00"
 */
export function formatCurrency(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || isNaN(amount)) {
    return 'RM 0.00'
  }

  return `RM ${amount.toLocaleString('en-MY', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`
}

/**
 * Format a large number with K/M/B suffix
 * @param value - The number to format
 * @returns Formatted string with suffix
 * 
 * @example
 * formatCompactNumber(1234) // "1.2K"
 * formatCompactNumber(1234567) // "1.2M"
 * formatCompactNumber(1234567890) // "1.2B"
 */
export function formatCompactNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value)) {
    return '0'
  }

  if (value < 1000) {
    return value.toString()
  }

  if (value < 1000000) {
    return (value / 1000).toFixed(1) + 'K'
  }

  if (value < 1000000000) {
    return (value / 1000000).toFixed(1) + 'M'
  }

  return (value / 1000000000).toFixed(1) + 'B'
}

/**
 * Format a percentage value
 * @param value - The value to format (e.g., 0.15 for 15%)
 * @param decimals - Number of decimal places (default: 0)
 * @returns Formatted percentage string
 * 
 * @example
 * formatPercent(0.15) // "15%"
 * formatPercent(0.1567, 2) // "15.67%"
 */
export function formatPercent(value: number | null | undefined, decimals: number = 0): string {
  if (value === null || value === undefined || isNaN(value)) {
    return '0%'
  }

  return `${(value * 100).toFixed(decimals)}%`
}

/**
 * Parse a formatted number string back to a number
 * @param value - The formatted string (e.g., "1,234.56")
 * @returns Parsed number
 * 
 * @example
 * parseFormattedNumber("1,234.56") // 1234.56
 * parseFormattedNumber("RM 1,234.56") // 1234.56
 */
export function parseFormattedNumber(value: string): number {
  // Remove all non-numeric characters except decimal point and minus sign
  const cleaned = value.replace(/[^0-9.-]/g, '')
  return parseFloat(cleaned) || 0
}
