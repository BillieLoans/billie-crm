import type { CollectionConfig } from 'payload'
import { hideFromNonAdmins, isAdmin } from '@/lib/access'

/**
 * Google Ads offline click conversions (BTB-546): the outbox.
 *
 * One row per (application, conversion, action), unique in Postgres
 * (payload.config.ts afterSchemaInit). Rows are written only by the sender in
 * `src/server/google-ads/conversions.ts`, which fills the outbox from the
 * decision and loan projections and drains it to Google Ads. Nobody can
 * create, change or delete a row through the API.
 *
 * Conversions go through Google's Data Manager API, which cannot retract, so
 * only `upload` rows are written; `retract` is kept in the enum for history.
 *
 * Holds the click id, the conversion name and the time. Never amounts,
 * decline reasons or personal details. Not part of the `reporting` schema,
 * which deliberately leaves click ids out.
 */
export const GoogleAdsConversions: CollectionConfig = {
  slug: 'google-ads-conversions',
  labels: { singular: 'Google Ads conversion', plural: 'Google Ads conversions' },
  admin: {
    useAsTitle: 'applicationNumber',
    group: 'Marketing',
    defaultColumns: [
      'applicationNumber',
      'conversionName',
      'action',
      'status',
      'sentAt',
      'lastErrorCode',
    ],
    hidden: hideFromNonAdmins,
  },
  access: {
    read: ({ req }) => isAdmin(req.user),
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    { name: 'applicationNumber', type: 'text', required: true, index: true },
    { name: 'conversationId', type: 'text', index: true },
    {
      name: 'conversionName',
      type: 'select',
      required: true,
      options: [
        { label: 'Approved', value: 'approved' },
        { label: 'Funded', value: 'funded' },
      ],
    },
    {
      name: 'action',
      type: 'select',
      required: true,
      defaultValue: 'upload',
      options: [
        { label: 'Upload', value: 'upload' },
        { label: 'Retract', value: 'retract' },
      ],
    },
    {
      name: 'clickIdType',
      type: 'select',
      required: true,
      options: [
        { label: 'gclid', value: 'gclid' },
        { label: 'gbraid', value: 'gbraid' },
        { label: 'wbraid', value: 'wbraid' },
      ],
    },
    { name: 'clickId', type: 'text', required: true },
    { name: 'clickAt', type: 'date', admin: { description: 'When the ad was clicked' } },
    {
      name: 'convertedAt',
      type: 'date',
      required: true,
      admin: {
        description:
          'Upload: when the application was approved or funded. Retract: the adjustment time. Fixed when the row is written so a retry sends the same value.',
      },
    },
    {
      name: 'notBefore',
      type: 'date',
      required: true,
      admin: {
        description: 'Not sent before this time (Google rejects clicks that are too recent)',
      },
    },
    {
      name: 'expiresAt',
      type: 'date',
      required: true,
      admin: {
        description:
          'Google accepts nothing after this (90 days from the click). A retraction carries its upload’s. Rows past it are never looked at again.',
      },
    },
    {
      name: 'mockOrigin',
      type: 'checkbox',
      defaultValue: false,
      admin: { description: 'From a mock credit decision; never sent live' },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'pending',
      // Indexed with notBefore (payload.config.ts afterSchemaInit).
      options: [
        { label: 'Pending', value: 'pending' },
        { label: 'Sending', value: 'sending' },
        { label: 'Sent', value: 'sent' },
        { label: 'Failed', value: 'failed' },
        { label: 'Expired', value: 'expired' },
        { label: 'Cancelled', value: 'cancelled' },
      ],
    },
    {
      name: 'statusReason',
      type: 'text',
      admin: { description: 'Why a row was cancelled or expired (DECISION_REVISED, KILLED, ...)' },
    },
    { name: 'attempts', type: 'number', defaultValue: 0 },
    {
      name: 'lastErrorCode',
      type: 'text',
      admin: { description: "Google's error code from the last attempt (never its message)" },
    },
    { name: 'lastAttemptAt', type: 'date' },
    { name: 'claimedAt', type: 'date' },
    { name: 'sentAt', type: 'date' },
    {
      name: 'validatedAt',
      type: 'date',
      admin: {
        description:
          'Checked by Google in validate-only mode (the result is in Last error code; empty means accepted). Each row is checked once.',
      },
    },
  ],
}
