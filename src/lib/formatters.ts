/**
 * Shared formatters for consistent Australian locale formatting across the application.
 * Consolidates currency and date formatting to avoid duplication.
 */

/** Australian currency formatter - formats as $X,XXX.XX AUD */
export const currencyFormatter = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
})

/** Australian date formatter - short format (DD/MM/YY, HH:MM am/pm) */
export const dateFormatterShort = new Intl.DateTimeFormat('en-AU', {
  dateStyle: 'short',
  timeStyle: 'short',
})

/** Australian date formatter - medium format (DD Mon YYYY, HH:MM am/pm) */
export const dateFormatterMedium = new Intl.DateTimeFormat('en-AU', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

/** Australian date formatter - date only (DD/MM/YYYY) */
export const dateFormatterDateOnly = new Intl.DateTimeFormat('en-AU', {
  dateStyle: 'short',
})

/** Australian date formatter - long format for display (e.g., "Thursday, 11 December 2025") */
export const dateFormatterLong = new Intl.DateTimeFormat('en-AU', {
  dateStyle: 'full',
})

/**
 * Format a currency amount with proper Australian locale.
 * @param amount - The numeric amount to format
 * @returns Formatted currency string (e.g., "$1,234.56")
 */
export function formatCurrency(amount: number): string {
  return currencyFormatter.format(amount)
}

/**
 * Format a date in short Australian format.
 * @param date - Date string or Date object
 * @returns Formatted date string (e.g., "11/12/25, 2:30 pm")
 */
export function formatDateShort(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return dateFormatterShort.format(d)
}

/**
 * Format a date in medium Australian format.
 * @param date - Date string or Date object
 * @returns Formatted date string (e.g., "11 Dec 2025, 2:30 pm")
 */
export function formatDateMedium(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return dateFormatterMedium.format(d)
}

/**
 * Format a timestamp as relative time (e.g., "5 minutes ago").
 * Used in notifications and failed actions panels.
 * @param timestamp - ISO date string or Date object
 * @param showAbsoluteAfterWeek - If true, shows absolute date after 7 days (default: false)
 * @returns Human-readable relative time string
 */
export function formatRelativeTime(timestamp: string | Date, showAbsoluteAfterWeek = false): string {
  // MongoDB stores naive UTC datetimes (no 'Z'). new Date() treats those as local time,
  // shifting by UTC offset (e.g. UTC+11 in Sydney = "11h ago" for a just-now event).
  // Append 'Z' if the string has no timezone indicator so it's always parsed as UTC.
  const hasTimezone = typeof timestamp !== 'string' ||
    /Z$/i.test(timestamp) ||
    /[+-]\d{2}:?\d{2}$/.test(timestamp)
  const date = typeof timestamp === 'string'
    ? new Date(hasTimezone ? timestamp : timestamp + 'Z')
    : timestamp
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (showAbsoluteAfterWeek && diffDays >= 7) {
    return date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
  }
  return `${diffDays}d ago`
}
