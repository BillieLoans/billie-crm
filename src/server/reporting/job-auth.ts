/**
 * Authentication for scheduled reporting jobs (BTB-504, BTB-507).
 *
 * Jobs are called by a Fly scheduled machine, not a staff session, so they
 * carry `Authorization: Bearer <REPORTING_JOB_TOKEN>`. Compared in constant
 * time. With no token configured, every call is refused.
 */
import { safeEqual } from '@/lib/intake-auth'

export function isReportingJobAuthorised(request: Request): boolean {
  const expected = process.env.REPORTING_JOB_TOKEN
  if (!expected) return false
  const header = request.headers.get('authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match !== null && safeEqual(match[1], expected)
}
