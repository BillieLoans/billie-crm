/**
 * Print the SQL that grants `reporting_mcp_reader` its columns (ADR 0002),
 * for an environment where the role was created after the migration that
 * grants it ran. Paste the output into the owner connection on the primary.
 *
 *   pnpm exec tsx scripts/mcp-reader-grants.ts
 */
import { mcpReaderGrants } from '../src/server/reporting/schema'
import { MCP_READER_ROLE } from '../src/server/reporting/runner'

console.log(
  [
    `REVOKE ALL ON ALL TABLES IN SCHEMA reporting FROM ${MCP_READER_ROLE}`,
    `GRANT USAGE ON SCHEMA reporting TO ${MCP_READER_ROLE}`,
    ...mcpReaderGrants(),
  ]
    .map((statement) => `${statement};`)
    .join('\n'),
)
