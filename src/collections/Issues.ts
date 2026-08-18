import type { CollectionConfig, Access } from 'payload'
import { canReportIssue, isAdmin, hideFromNonAdmins } from '@/lib/access'
import { issueDiagnosticsSchema } from '@/lib/schemas/issues'

/**
 * Access control: Any authenticated user with a valid role (except `service`)
 * can file a problem report
 */
const canCreate: Access = ({ req }) => {
  return canReportIssue(req.user)
}

/**
 * Access control: Only Admin can read problem reports — diagnostics payloads
 * carry reporter identity and recent API activity
 */
const canRead: Access = ({ req }) => {
  return isAdmin(req.user)
}

/**
 * Access control: Only Admin can triage (status + resolutionNote via beforeChange)
 */
const canUpdate: Access = ({ req }) => {
  return isAdmin(req.user)
}

/**
 * Access control: Only Admin can delete problem reports
 */
const canDelete: Access = ({ req }) => {
  return isAdmin(req.user)
}

/** Title is derived from the first line of the description, capped for the admin grid. */
const TITLE_MAX_LENGTH = 80

function deriveTitle(description: unknown): string {
  if (typeof description !== 'string') return 'Untitled issue'
  const firstLine = description.split('\n')[0]?.trim() ?? ''
  if (!firstLine) return 'Untitled issue'
  return firstLine.length > TITLE_MAX_LENGTH ? firstLine.slice(0, TITLE_MAX_LENGTH) : firstLine
}

/**
 * Issues Collection
 *
 * In-app problem reports raised by staff from the CRM itself. The reporter
 * submits a description plus an auto-collected `diagnostics` payload (route,
 * device, recent interactions / API calls / errors) and an optional screenshot
 * stored in S3. Reports are append-only for the reporter — only an admin can
 * triage them, and only the `status` and `resolutionNote` fields may change.
 */
export const Issues: CollectionConfig = {
  slug: 'issues',
  admin: {
    useAsTitle: 'title',
    group: 'System',
    defaultColumns: ['title', 'status', 'reportedBy', 'createdAt'],
    description: 'In-app problem reports raised by staff, with captured diagnostics',
    hidden: hideFromNonAdmins,
  },
  access: {
    read: canRead,
    create: canCreate,
    update: canUpdate,
    delete: canDelete,
  },
  hooks: {
    beforeValidate: [
      async ({ data, operation }) => {
        if (!data) return data

        // The diagnostics payload is client-supplied — validate its shape (and
        // size ceiling) before it ever reaches the json column.
        if ('diagnostics' in data && data.diagnostics != null) {
          const validation = issueDiagnosticsSchema.safeParse(data.diagnostics)
          if (!validation.success) {
            throw new Error(
              `Invalid diagnostics payload: ${validation.error.issues[0]?.message ?? 'unknown error'}`,
            )
          }
        }

        if (operation === 'create') {
          // Title is derived, never client-supplied
          data.title = deriveTitle(data.description)
        }

        return data
      },
    ],
    beforeChange: [
      async ({ data, operation, originalDoc, req }) => {
        if (operation === 'create') {
          // Auto-populate reportedBy from the authenticated user
          if (req.user) {
            data.reportedBy = req.user.id
          }

          // New reports always start open; resolution fields are triage-only.
          data.status = 'open'
          delete data.resolvedAt
          delete data.resolvedBy
          delete data.resolutionNote
        }

        if (operation === 'update') {
          // Reports are immutable apart from triage: only the status and the
          // resolution note may be changed after creation.
          //
          // Payload merges the stored document into `data` before this hook
          // runs, so disallowed keys must be RESTORED from `originalDoc` rather
          // than deleted — deleting them would strip required fields off the
          // full document and fail field validation.
          const allowedUpdateFields = new Set(['status', 'resolutionNote'])
          const immutableMetaFields = new Set(['id', 'createdAt', 'updatedAt'])
          for (const key of Object.keys(data)) {
            if (allowedUpdateFields.has(key) || immutableMetaFields.has(key)) continue
            if (originalDoc && key in originalDoc) {
              data[key] = originalDoc[key]
            } else {
              delete data[key]
            }
          }

          const previousStatus = originalDoc?.status

          if (data.status === 'resolved' && previousStatus !== 'resolved') {
            data.resolvedAt = new Date().toISOString()
            data.resolvedBy = req.user ? req.user.id : null
          }

          // Reopening clears the resolution stamps but keeps the note as history.
          if (data.status === 'open' && previousStatus === 'resolved') {
            data.resolvedAt = null
            data.resolvedBy = null
          }
        }

        return data
      },
    ],
  },
  fields: [
    // ==========================================================================
    // Report Content
    // ==========================================================================
    {
      name: 'title',
      type: 'text',
      maxLength: 120,
      admin: {
        readOnly: true,
        description: 'Derived from the first line of the description (auto-set)',
      },
    },
    {
      name: 'description',
      type: 'textarea',
      required: true,
      maxLength: 5000,
      admin: {
        description: 'What the reporter was doing and what went wrong',
      },
    },
    {
      name: 'triggerReason',
      type: 'text',
      maxLength: 120,
      admin: {
        description:
          'What prompted the report — `server-error` / `network-error`, or blank when raised manually',
      },
    },
    {
      name: 'screenshotUri',
      type: 'text',
      admin: {
        readOnly: true,
        description: 'S3 URI of the captured screenshot (s3://…), if one was attached',
      },
    },
    {
      name: 'diagnostics',
      type: 'json',
      required: true,
      admin: {
        readOnly: true,
        description: 'Captured context, device, interactions, routes, API calls and errors',
      },
    },
    // ==========================================================================
    // Triage
    // ==========================================================================
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'open',
      options: [
        { label: 'Open', value: 'open' },
        { label: 'Resolved', value: 'resolved' },
      ],
      index: true,
      admin: {
        description: 'Open = awaiting triage. Resolved = actioned or dismissed.',
        position: 'sidebar',
      },
    },
    {
      name: 'resolutionNote',
      type: 'textarea',
      maxLength: 5000,
      admin: {
        description: 'What was done about this report',
      },
    },
    {
      name: 'resolvedAt',
      type: 'date',
      admin: {
        readOnly: true,
        description: 'When the report was resolved (auto-set)',
        position: 'sidebar',
      },
    },
    {
      name: 'resolvedBy',
      type: 'relationship',
      relationTo: 'users',
      admin: {
        readOnly: true,
        description: 'User who resolved this report (auto-populated from session)',
        position: 'sidebar',
      },
    },
    // ==========================================================================
    // Authorship
    // ==========================================================================
    {
      name: 'reportedBy',
      type: 'relationship',
      relationTo: 'users',
      index: true,
      admin: {
        readOnly: true,
        description: 'User who filed this report (auto-populated from session)',
        position: 'sidebar',
      },
    },
  ],
  timestamps: true,
}
