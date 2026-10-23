/**
 * Record what people do with reports (searches, downloads, copies) for the
 * Reports usage page. Fire and forget: never awaited, never shown.
 */
export type ReportEvent =
  | { kind: 'search'; query: string }
  | { kind: 'search_open'; query: string; reportSlug: string }
  | { kind: 'csv' | 'copy_link' | 'copy_table' | 'copy_chart'; reportSlug: string }

export function logReportEvent(event: ReportEvent): void {
  try {
    void fetch('/api/reports/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      keepalive: true,
      body: JSON.stringify(event),
    }).catch(() => undefined)
  } catch {
    // A missed event never matters to the person using the page.
  }
}
