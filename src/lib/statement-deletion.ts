/**
 * Helpers for deleting a customer's bank-statement files from S3.
 *
 * Only two sub-folders per application are ever in scope. `StatementCapture/`
 * is deliberately excluded.
 */

export const STATEMENT_SUBFOLDERS = ['statements', 'AffordabilityReports'] as const

const APPLICATION_NUMBER_PATTERN = /^[A-Za-z0-9_-]+$/

export type DeletionWarning = 'in_progress' | 'funded_loan'
export type DeletionStatus = 'deleted' | 'partial' | 'failed' | 'nothing_found'

export const DELETION_WARNING_COPY: Record<DeletionWarning, string> = {
  in_progress:
    "This application is still in progress. Deleting its statements may break the assessment that's about to read them.",
  funded_loan:
    'This application has a funded loan. Responsible-lending record-keeping may require keeping these statements — check before going ahead.',
}

export const KEPT_DATA_COPY =
  'Kept: the affordability summary, account-holder names and credit assessment records in the CRM, and anything held by TaleFin.'

export const CONFIRM_WORD = 'DELETE'

/**
 * Starts the error on an application whose post-delete re-list failed: the
 * outcome is unverified, so the result says to check again.
 */
export const UNCONFIRMED_DELETION_ERROR = 'Could not confirm deletion'

/** "1 file", "3 files". */
export const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

/**
 * The confirm step's warning. The files go from Billie's bucket now; the
 * backup bucket's copies become noncurrent through the replicated delete
 * marker, and its lifecycle rule erases them after 180 days. Lifecycle runs
 * asynchronously after the due date, so the copy promises no deadline.
 */
export function confirmDeletionWarning(files: number, applications: number): string {
  return `${plural(files, 'file')} across ${plural(applications, 'application')} will be deleted from Billie's storage now. Backup copies are erased after 180 days.`
}

export function isValidApplicationNumber(value: unknown): value is string {
  return typeof value === 'string' && APPLICATION_NUMBER_PATTERN.test(value)
}

/** The S3 prefixes (each ending in `/`) holding one application's statement files. */
export function statementPrefixes(baseFolder: string, applicationNumber: string): string[] {
  if (!isValidApplicationNumber(applicationNumber)) {
    throw new Error('Invalid application number')
  }
  const base = String(baseFolder ?? '').replace(/^\/+|\/+$/g, '')
  if (!base) {
    throw new Error('Statement base folder is not configured')
  }
  return STATEMENT_SUBFOLDERS.map((sub) => `${base}/${applicationNumber}/${sub}/`)
}

export function isKeyWithinPrefixes(key: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => prefix.endsWith('/') && key.startsWith(prefix))
}
