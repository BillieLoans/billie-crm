import type { CollectionConfig, Access } from 'payload'
import { hasAnyRole, hasApprovalAuthority, hideFromNonAdmins } from '@/lib/access'

/** Any operator who can work the disbursement queue can write an entry. */
const canCreate: Access = ({ req: { user } }) => hasAnyRole(user)

/** Reading the audit trail is a supervisory act, not an everyday one. */
const canRead: Access = ({ req: { user } }) => hasApprovalAuthority(user)

/**
 * Append-only record of who saw or copied a customer's payout bank details.
 *
 * `docs/ux-standards.md` §4 requires that full identifiers are not rendered by
 * default and that every reveal is audited (Privacy Act APP 11, insider-risk
 * reduction). The disbursement queue (BTB-279) is the one screen that has to put
 * a real BSB and account number in front of staff, so this is where that
 * obligation lands.
 *
 * A copy is logged as well as a reveal: putting an account number on the
 * clipboard discloses it just as effectively as showing it, and the whole point
 * of the queue is that operators copy rather than read.
 *
 * Unlike the servicing projections, this collection is written by the CRM itself
 * (like Issues and WriteOffRequests) — nothing upstream knows what staff looked at.
 * It is never updated or deleted: an audit trail that can be edited is not one.
 */
export const DisbursementAccessLog: CollectionConfig = {
  slug: 'disbursement-access-log',
  admin: {
    useAsTitle: 'loanAccountId',
    defaultColumns: ['occurredAt', 'actorEmail', 'action', 'field', 'accountNumber'],
    group: 'Servicing',
    description: 'Audit trail of payout bank-detail reveals and copies',
    hidden: hideFromNonAdmins,
  },
  access: {
    read: canRead,
    create: canCreate,
    update: () => false, // Append-only
    delete: () => false,
  },
  fields: [
    {
      name: 'loanAccountId',
      type: 'text',
      required: true,
      index: true,
      admin: { readOnly: true },
    },
    {
      // Denormalised so the log stays readable if the projection is later rebuilt.
      name: 'accountNumber',
      type: 'text',
      admin: { readOnly: true, description: "Billie's loan account number, for readability" },
    },
    {
      name: 'action',
      type: 'select',
      required: true,
      options: [
        { label: 'Revealed on screen', value: 'reveal' },
        { label: 'Copied to clipboard', value: 'copy' },
      ],
      index: true,
      admin: { readOnly: true },
    },
    {
      name: 'field',
      type: 'select',
      required: true,
      options: [
        { label: 'Account number', value: 'accountNumber' },
        { label: 'BSB', value: 'bsb' },
        { label: 'Account name', value: 'holder' },
        { label: 'All payment details', value: 'all' },
      ],
      admin: { readOnly: true, description: 'Which identifier was disclosed' },
    },
    {
      name: 'actor',
      type: 'relationship',
      relationTo: 'users',
      index: true,
      admin: { readOnly: true },
    },
    {
      // Kept alongside the relationship so the trail survives a user being removed.
      name: 'actorEmail',
      type: 'text',
      index: true,
      admin: { readOnly: true },
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
