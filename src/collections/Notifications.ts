import type { CollectionConfig, Access } from 'payload'
import { hideFromNonAdmins, hasAnyRole } from '@/lib/access'

const anyRole: Access = ({ req: { user } }) => hasAnyRole(user)

/**
 * Notifications — read-only projection.
 *
 * Written by the Python event processor from three platform inbox events:
 *   notification.sent.v1            → status = 'sent'
 *   notification.delivery_failed.v1 → status = 'failed' (or 'blocked' when error_type='suppressed')
 *   statement.generated.v1          → status = 'statement'
 *
 * One document per ``notificationId`` (unique). Surfaced on the customer view
 * in the Communications panel alongside contact notes.
 */
export const Notifications: CollectionConfig = {
  slug: 'notifications',
  admin: {
    useAsTitle: 'notificationId',
    defaultColumns: ['notificationId', 'customerId', 'status', 'channel', 'templateName', 'eventAt'],
    group: 'Supervisor Dashboard',
    hidden: hideFromNonAdmins,
  },
  access: {
    read: anyRole,
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    {
      name: 'notificationId',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: { readOnly: true },
    },
    {
      name: 'idempotencyKey',
      type: 'text',
      index: true,
      admin: { readOnly: true },
    },
    {
      name: 'requestId',
      type: 'text',
      admin: { readOnly: true },
    },
    {
      name: 'customerRef',
      type: 'relationship',
      relationTo: 'customers',
      admin: {
        readOnly: true,
        description: 'Resolved customer link (may be null if customer not yet projected)',
      },
    },
    {
      name: 'customerId',
      type: 'text',
      index: true,
      admin: {
        readOnly: true,
        description: 'Customer ID string from the event (PII-safe identifier)',
      },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      index: true,
      options: [
        { label: 'Sent', value: 'sent' },
        { label: 'Failed', value: 'failed' },
        { label: 'Blocked (suppression)', value: 'blocked' },
        { label: 'Statement issued', value: 'statement' },
        { label: 'Suppression change', value: 'suppression_change' },
      ],
      admin: { readOnly: true },
    },
    {
      name: 'channel',
      type: 'select',
      options: [
        { label: 'Email', value: 'email' },
        { label: 'SMS', value: 'sms' },
      ],
      admin: { readOnly: true },
    },
    {
      name: 'templateName',
      type: 'text',
      admin: { readOnly: true },
    },
    {
      name: 'templateContentHash',
      type: 'text',
      admin: {
        readOnly: true,
        description: 'sha256 of the .j2 template file used at send time',
      },
    },
    {
      name: 'templateGitSha',
      type: 'text',
      admin: { readOnly: true },
    },
    {
      name: 'provider',
      type: 'text',
      admin: {
        readOnly: true,
        description: "'resend' | 'clicksend' | 'dryrun'",
      },
    },
    {
      name: 'providerMessageId',
      type: 'text',
      admin: { readOnly: true },
    },
    {
      name: 'recipientHash',
      type: 'text',
      admin: {
        readOnly: true,
        description: 'sha256 of recipient — PII safe',
      },
    },
    {
      name: 'correlationId',
      type: 'text',
      admin: { readOnly: true },
    },
    {
      name: 'eventAt',
      type: 'date',
      required: true,
      index: true,
      admin: {
        readOnly: true,
        description: 'sent_at / failed_at / dispatched_at — unified sort key for the timeline',
      },
    },
    {
      name: 'sentAt',
      type: 'date',
      admin: { readOnly: true },
    },
    {
      name: 'tags',
      type: 'group',
      admin: { readOnly: true },
      fields: [
        { name: 'category', type: 'text', admin: { readOnly: true } },
        { name: 'reason', type: 'text', admin: { readOnly: true } },
        { name: 'step', type: 'number', admin: { readOnly: true } },
      ],
    },
    {
      name: 'failure',
      type: 'group',
      admin: {
        readOnly: true,
        description: 'Populated when status is "failed" or "blocked"',
      },
      fields: [
        { name: 'failedAt', type: 'date', admin: { readOnly: true } },
        {
          name: 'errorType',
          type: 'select',
          options: [
            { label: 'Transient', value: 'transient' },
            { label: 'Permanent', value: 'permanent' },
            { label: 'Auth', value: 'auth' },
            { label: 'Template', value: 'template' },
            { label: 'Contact missing', value: 'contact_missing' },
            { label: 'Opt-out', value: 'opt_out' },
            { label: 'Suppressed (kill switch)', value: 'suppressed' },
          ],
          admin: { readOnly: true },
        },
        { name: 'errorMessage', type: 'text', admin: { readOnly: true } },
        { name: 'attempt', type: 'number', admin: { readOnly: true } },
        {
          name: 'fallbackSuggested',
          type: 'text',
          admin: {
            readOnly: true,
            description: "'email' | 'sms' | null — set on contact_missing",
          },
        },
      ],
    },
    {
      name: 'statement',
      type: 'group',
      admin: {
        readOnly: true,
        description: 'Populated when status is "statement"',
      },
      fields: [
        { name: 'accountId', type: 'text', admin: { readOnly: true } },
        { name: 'periodStart', type: 'date', admin: { readOnly: true } },
        { name: 'periodEnd', type: 'date', admin: { readOnly: true } },
        { name: 'dispatchedAt', type: 'date', admin: { readOnly: true } },
      ],
    },
    {
      name: 'suppression',
      type: 'group',
      admin: {
        readOnly: true,
        description: 'Populated when status is "suppression_change"',
      },
      fields: [
        {
          name: 'mode',
          type: 'select',
          options: [
            { label: 'All notifications paused', value: 'all' },
            { label: 'Non-essential paused', value: 'non_essential' },
            { label: 'Marketing only paused', value: 'marketing_only' },
            { label: 'Cleared / re-enabled', value: 'off' },
          ],
          admin: { readOnly: true },
        },
        { name: 'reason', type: 'text', admin: { readOnly: true } },
        { name: 'setBy', type: 'text', admin: { readOnly: true } },
        { name: 'setAt', type: 'date', admin: { readOnly: true } },
        { name: 'expiresAt', type: 'date', admin: { readOnly: true } },
      ],
    },
    {
      name: 'createdAt',
      type: 'date',
      admin: { readOnly: true },
    },
    {
      name: 'updatedAt',
      type: 'date',
      admin: { readOnly: true },
    },
  ],
}
