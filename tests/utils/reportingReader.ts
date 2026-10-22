/**
 * A pool logged in as `reporting_reader`, as REPORTING_DATABASE_URI is in a
 * deployed environment (BTB-506). Creates the role in the test database,
 * gives it a login and re-applies the reporting grants.
 */
import { Pool } from 'pg'
import { applyReportingSchema } from '@/server/reporting/schema'

const READER_PASSWORD = 'reader-int-test'

export async function reportingReaderPool(owner: {
  query: (text: string) => Promise<unknown>
}): Promise<Pool> {
  await owner.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'reporting_reader') THEN
      CREATE ROLE reporting_reader;
    END IF;
  END $$`)
  await owner.query(`ALTER ROLE reporting_reader LOGIN PASSWORD '${READER_PASSWORD}'`)
  await applyReportingSchema(owner)
  // max 1: every run shares one connection, so leaked session state would show.
  return new Pool({ connectionString: reportingReaderUri(), max: 1 })
}

/** The test database's URI, logged in as reporting_reader (after `reportingReaderPool`). */
export function reportingReaderUri(): string {
  const uri = new URL(process.env.DATABASE_URI as string)
  uri.username = 'reporting_reader'
  uri.password = READER_PASSWORD
  return uri.toString()
}
