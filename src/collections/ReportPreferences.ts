import type { CollectionConfig } from 'payload'
import { hideFromNonAdmins, isAdmin } from '@/lib/access'

/**
 * Each person's own Reports settings: the reports they pinned to the top of
 * the Reports home and sidebar. One row per user, written only through
 * `/api/reports/preferences` for the signed-in user.
 */
export const ReportPreferences: CollectionConfig = {
  slug: 'report-preferences',
  labels: { singular: 'Report preference', plural: 'Report preferences' },
  admin: {
    useAsTitle: 'user',
    group: 'Reporting',
    hidden: hideFromNonAdmins,
  },
  access: {
    read: ({ req }) => isAdmin(req.user),
    create: () => false,
    update: () => false,
    delete: ({ req }) => isAdmin(req.user),
  },
  fields: [
    // Not required in the database: a deleted user's row is left with no
    // user (the foreign key sets it to NULL) rather than blocking the delete.
    // The preferences route always sets it.
    { name: 'user', type: 'relationship', relationTo: 'users', unique: true },
    {
      name: 'pinned',
      type: 'json',
      defaultValue: [],
      admin: { description: 'Report slugs, in pin order.' },
    },
  ],
}
