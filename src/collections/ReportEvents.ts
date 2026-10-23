import type { CollectionConfig } from 'payload'
import { hideFromNonAdmins, isAdmin } from '@/lib/access'

export const REPORT_EVENT_KINDS = [
  'search',
  'search_open',
  'csv',
  'copy_link',
  'copy_table',
  'copy_chart',
  'ask_save',
] as const
export type ReportEventKind = (typeof REPORT_EVENT_KINDS)[number]

/**
 * What people do with reports besides running them (runs are in
 * `report-runs`): searching the catalogue, opening a search result,
 * downloading or copying. Feeds the Reports usage page, so we can see
 * whether people find answers on the page or take them to a spreadsheet,
 * and what they look for that does not exist.
 *
 * Append-only, written by `/api/reports/events` with `overrideAccess`.
 * Search text is cut to 60 characters; the search box is for report names.
 */
export const ReportEvents: CollectionConfig = {
  slug: 'report-events',
  labels: { singular: 'Report event', plural: 'Report events' },
  admin: {
    useAsTitle: 'kind',
    group: 'Reporting',
    defaultColumns: ['kind', 'reportSlug', 'query', 'user', 'createdAt'],
    hidden: hideFromNonAdmins,
  },
  access: {
    read: ({ req }) => isAdmin(req.user),
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    {
      name: 'kind',
      type: 'select',
      required: true,
      index: true,
      options: REPORT_EVENT_KINDS.map((k) => ({ label: k, value: k })),
    },
    { name: 'reportSlug', type: 'text', index: true },
    { name: 'query', type: 'text' },
    { name: 'user', type: 'relationship', relationTo: 'users', index: true },
  ],
}
