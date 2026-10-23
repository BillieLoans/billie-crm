import type { Access, CollectionConfig, Validate } from 'payload'
import { hasApprovalAuthority, isAdmin } from '@/lib/access'
import { boardTilesSchema } from '@/lib/reports/boards'
import { REPORT_SLUG_RE } from '@/lib/schemas/reports'

const canAuthor: Access = ({ req }) => hasApprovalAuthority(req.user)

const validateTiles: Validate = (value) => {
  const parsed = boardTilesSchema.safeParse(value ?? [])
  return parsed.success ? true : (parsed.error.issues[0]?.message ?? 'Invalid tiles')
}

/**
 * Report boards: a page of report tiles that share one period, at
 * `/admin/reports/boards/<slug>`. Any staff member can open a board and
 * sees the tiles for reports they can run; report authors make and change
 * boards. A tile names a report by its link, so a board needs no change
 * when the report is republished.
 */
export const ReportBoards: CollectionConfig = {
  slug: 'report-boards',
  labels: { singular: 'Report board', plural: 'Report boards' },
  admin: {
    useAsTitle: 'title',
    group: 'Reporting',
    defaultColumns: ['title', 'slug', 'updatedAt'],
    hidden: ({ user }) => !hasApprovalAuthority(user),
  },
  // Staff open boards through /api/reports/boards, which shows each person
  // only the tiles they can run; the raw collection is for authors.
  access: {
    read: canAuthor,
    create: canAuthor,
    update: canAuthor,
    delete: ({ req }) => hasApprovalAuthority(req.user) || isAdmin(req.user),
  },
  fields: [
    { name: 'title', type: 'text', required: true, maxLength: 120 },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      validate: (value: unknown) =>
        typeof value === 'string' && REPORT_SLUG_RE.test(value)
          ? true
          : 'Use lower case letters, digits and single hyphens',
      admin: { description: 'Used in the board link: /admin/reports/boards/<slug>' },
    },
    { name: 'description', type: 'textarea', maxLength: 500 },
    {
      name: 'tiles',
      type: 'json',
      defaultValue: [],
      validate: validateTiles,
      admin: { description: 'A list of {id, report, parameters, show}.' },
    },
    {
      name: 'author',
      type: 'relationship',
      relationTo: 'users',
      admin: { position: 'sidebar', readOnly: true },
      access: { create: () => false, update: () => false },
      hooks: {
        beforeChange: [
          ({ value, operation, req }) =>
            operation === 'create' && !value && req.user ? req.user.id : value,
        ],
      },
    },
  ],
}
