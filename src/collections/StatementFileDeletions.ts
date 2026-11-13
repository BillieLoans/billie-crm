import type { CollectionConfig, Access } from 'payload'
import { hasApprovalAuthority, hideFromNonAdmins } from '@/lib/access'

/** Reading the trail is a supervisory act. */
const canRead: Access = ({ req: { user } }) => hasApprovalAuthority(user)

/**
 * Append-only record of every permanent deletion of a customer's bank-statement
 * files from S3, one row per application per deletion request.
 *
 * The files themselves are gone once deleted (version-aware, so they cannot be
 * recovered), which makes this row the only evidence of what was removed, by
 * whom and why. It is written by the CRM itself (`src/server/statement-deletion.ts`)
 * rather than projected from events, and it is never updated or deleted.
 */
export const StatementFileDeletions: CollectionConfig = {
  slug: 'statement-file-deletions',
  admin: {
    useAsTitle: 'applicationNumber',
    defaultColumns: [
      'occurredAt',
      'applicationNumber',
      'status',
      'filesDeleted',
      'actorEmail',
      'scope',
    ],
    group: 'Servicing',
    description: 'Audit trail of permanent bank-statement file deletions from S3',
    hidden: hideFromNonAdmins,
  },
  access: {
    read: canRead,
    // Rows are written only by the deletion service (overrideAccess), so no one
    // can forge an audit row through the REST API.
    create: () => false,
    update: () => false, // Append-only
    delete: () => false,
  },
  fields: [
    {
      name: 'conversationId',
      type: 'text',
      required: true,
      index: true,
      admin: { readOnly: true },
    },
    {
      name: 'applicationNumber',
      type: 'text',
      index: true,
      admin: { readOnly: true },
    },
    {
      name: 'customerIdString',
      type: 'text',
      index: true,
      admin: { readOnly: true },
    },
    {
      name: 'scope',
      type: 'select',
      required: true,
      options: [
        { label: 'One application', value: 'application' },
        { label: 'Whole customer', value: 'customer' },
      ],
      admin: { readOnly: true, description: 'What the operator asked to delete' },
    },
    {
      name: 'actorId',
      type: 'text',
      required: true,
      admin: { readOnly: true },
    },
    {
      // Kept as text so the trail survives a user being removed.
      name: 'actorEmail',
      type: 'text',
      admin: { readOnly: true },
    },
    {
      name: 'actorName',
      type: 'text',
      admin: { readOnly: true },
    },
    {
      name: 'reason',
      type: 'textarea',
      required: true,
      admin: { readOnly: true },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      options: [
        { label: 'Deleted', value: 'deleted' },
        { label: 'Partly deleted', value: 'partial' },
        { label: 'Failed', value: 'failed' },
        { label: 'Nothing found', value: 'nothing_found' },
      ],
      admin: { readOnly: true },
    },
    {
      name: 'filesFound',
      type: 'number',
      required: true,
      admin: { readOnly: true, description: 'Object versions found under the prefixes' },
    },
    {
      name: 'filesDeleted',
      type: 'number',
      required: true,
      admin: {
        readOnly: true,
        description: 'Object versions confirmed gone by re-listing after the delete',
      },
    },
    {
      name: 'warnings',
      type: 'select',
      hasMany: true,
      options: [
        { label: 'Application in progress', value: 'in_progress' },
        { label: 'Funded loan', value: 'funded_loan' },
      ],
      admin: { readOnly: true, description: 'Warnings shown to the operator, who went ahead' },
    },
    {
      name: 'error',
      type: 'text',
      admin: { readOnly: true, description: 'Why the application failed or could not be verified' },
    },
    {
      name: 'deletedKeys',
      type: 'json',
      admin: { readOnly: true, description: 'S3 keys removed' },
    },
    {
      name: 'failedKeys',
      type: 'json',
      admin: { readOnly: true, description: 'S3 keys that could not be removed' },
    },
    {
      name: 'occurredAt',
      type: 'date',
      required: true,
      index: true,
      admin: { readOnly: true },
    },
  ],
}
