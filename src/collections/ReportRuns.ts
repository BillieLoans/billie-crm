import type { CollectionConfig } from 'payload'
import { hideFromNonAdmins, isAdmin } from '@/lib/access'

/**
 * Report runs (BTB-506): an append-only log of every report run.
 *
 * Written only by the report route with `overrideAccess`; nobody can create,
 * change or delete a run through the API. Records which report and version
 * ran, for whom, with which parameters, how long it took and how many rows
 * it returned. Only the report's declared parameters are logged, and text
 * values are cut to 100 characters. Authors should not define text
 * parameters that take customer details.
 */
export const ReportRuns: CollectionConfig = {
  slug: 'report-runs',
  labels: { singular: 'Report run', plural: 'Report runs' },
  admin: {
    useAsTitle: 'reportSlug',
    group: 'Reporting',
    defaultColumns: ['reportSlug', 'outcome', 'user', 'rowCount', 'durationMs', 'createdAt'],
    hidden: hideFromNonAdmins,
  },
  access: {
    read: ({ req }) => isAdmin(req.user),
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    { name: 'reportSlug', type: 'text', index: true },
    { name: 'report', type: 'relationship', relationTo: 'report-definitions' },
    {
      name: 'version',
      type: 'text',
      admin: { description: 'Published version id, or "draft"' },
    },
    { name: 'user', type: 'relationship', relationTo: 'users', index: true },
    { name: 'parameters', type: 'json' },
    {
      name: 'outcome',
      type: 'select',
      required: true,
      options: [
        { label: 'Succeeded', value: 'ok' },
        { label: 'Timed out', value: 'timeout' },
        { label: 'Refused', value: 'refused' },
        { label: 'Failed', value: 'error' },
      ],
    },
    { name: 'errorCode', type: 'text' },
    { name: 'durationMs', type: 'number' },
    { name: 'rowCount', type: 'number' },
    { name: 'truncated', type: 'checkbox', defaultValue: false },
  ],
}
