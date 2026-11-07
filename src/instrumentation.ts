/**
 * Next.js instrumentation hook: runs once when a server process starts.
 *
 * Starts the in-app hourly scheduler for Google Ads offline conversions
 * (BTB-546). It only starts in production with GOOGLE_ADS_CONVERSIONS_MODE
 * set to validate_only or live; see src/server/google-ads/scheduler.ts.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { startGoogleAdsScheduler } = await import('./server/google-ads/scheduler')
  startGoogleAdsScheduler()
}
