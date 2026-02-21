export const ACCOUNT_STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  in_arrears: 'In Arrears',
  closed: 'Closed',
  settled: 'Settled',
  written_off: 'Written Off',
}

export function getAccountStatusLabel(status: string | null | undefined): string {
  if (!status) return 'Unknown'
  if (ACCOUNT_STATUS_LABELS[status]) return ACCOUNT_STATUS_LABELS[status]
  return status
    .replaceAll('_', ' ')
    .split(' ')
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ')
}
